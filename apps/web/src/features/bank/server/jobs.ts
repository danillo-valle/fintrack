// A fila da sincronização com o banco (M09.1, ADR-011), com o pg-boss: as tarefas ficam numa
// tabela do próprio Postgres (esquema "pgboss"), então nenhum serviço novo precisa subir.
//
//   bank-sync         uma busca de UMA conexão. singletonKey = id da conexão: nunca duas
//                     buscas da mesma conexão na fila ao mesmo tempo (política "stately")
//   bank-sync-daily   a agenda: todo dia às 06:47 (São Paulo), depois do backup das 03:30,
//                     põe na fila uma busca de cada conexão pronta
//
// Quem pede: o botão "Buscar agora" (Server Action) e a agenda. Quem executa: o worker, que
// sobe junto com o servidor do app (instrumentation.ts) quando SYNC_WORKER=on. A busca nunca
// roda dentro da requisição de quem apertou o botão.
//
// Falha passageira (Pluggy fora do ar, muitas chamadas): 2 novas tentativas, com espera
// crescente. Credencial recusada não tenta de novo: a pessoa precisa trocar o Client Secret.
import "server-only";
import { connectionsDueForSync, describeOutcome, prisma, runSync } from "@fintrack/db";
import { PgBoss } from "pg-boss";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { pluggyFor } from "./provider";

export const SYNC_QUEUE = "bank-sync";
export const DAILY_QUEUE = "bank-sync-daily";
/** 06:47 em São Paulo: depois do backup (03:30) e do Meu Pluggy atualizar os bancos (madrugada) */
export const DAILY_CRON = "47 6 * * *";
export const TIME_ZONE = "America/Sao_Paulo";
const RETRIABLE = new Set(["PROVIDER_UNAVAILABLE", "PROVIDER_RATE_LIMITED", "SYNC_FAILED"]);

export type SyncJob = {
  connectionId: string;
  trigger: "SCHEDULED" | "MANUAL";
  requestedById: string | null;
};

const globalForBoss = globalThis as unknown as {
  fintrackBoss?: Promise<PgBoss>;
  fintrackWorker?: Promise<void>;
};

/** O pg-boss do processo (um só, mesmo com o recarregamento do `pnpm dev`). */
export function jobs(): Promise<PgBoss> {
  globalForBoss.fintrackBoss ??= (async () => {
    const boss = new PgBoss({ connectionString: env.DATABASE_URL, schema: "pgboss" });
    boss.on("error", (error: unknown) =>
      logger.error({ event: "jobs.error", err: error }, "erro na fila de tarefas"),
    );
    await boss.start();
    const existing = new Set((await boss.getQueues()).map((q) => q.name));
    if (!existing.has(SYNC_QUEUE)) {
      await boss.createQueue(SYNC_QUEUE, {
        policy: "stately",
        retryLimit: 2,
        retryDelay: 60,
        retryBackoff: true,
        expireInSeconds: 15 * 60,
      });
    }
    if (!existing.has(DAILY_QUEUE)) await boss.createQueue(DAILY_QUEUE, { policy: "stately" });
    return boss;
  })();
  return globalForBoss.fintrackBoss;
}

/** Põe uma busca da conexão na fila. Já há uma esperando? Não duplica (devolve false). */
export async function enqueueSync(job: SyncJob): Promise<boolean> {
  const boss = await jobs();
  const id = await boss.send(SYNC_QUEUE, job, { singletonKey: job.connectionId });
  return id !== null;
}

/** Executa UMA busca (o que o worker chama para cada tarefa da fila). */
export async function processSyncJob(job: SyncJob, attempt: number): Promise<void> {
  // O segredo é decifrado dentro da busca: chave errada vira "Falhou" com código, na tela
  const outcome = await runSync(prisma, { ...job, provider: () => pluggyFor(job.connectionId) });
  const log = {
    event: "sync.finished",
    connectionId: job.connectionId,
    trigger: job.trigger,
    attempt,
    status: outcome.status,
  };
  if (outcome.status === "FAILED") {
    logger.warn({ ...log, error: outcome.error }, describeOutcome(outcome));
    // Erro passageiro: lança, e o pg-boss tenta de novo mais tarde
    if (RETRIABLE.has(outcome.error)) throw new Error(outcome.error);
    return;
  }
  logger.info(log, describeOutcome(outcome));
}

/** Liga o worker e a agenda diária (uma vez por processo). */
export function startSyncWorker(): Promise<void> {
  globalForBoss.fintrackWorker ??= (async () => {
    const boss = await jobs();
    await boss.work<SyncJob>(SYNC_QUEUE, { batchSize: 1 }, async ([job]) => {
      if (job) await processSyncJob(job.data, job.retryCount + 1);
    });
    await boss.work(DAILY_QUEUE, async () => {
      for (const connectionId of await connectionsDueForSync(prisma)) {
        await enqueueSync({ connectionId, trigger: "SCHEDULED", requestedById: null });
      }
    });
    await boss.schedule(DAILY_QUEUE, DAILY_CRON, null, { tz: TIME_ZONE });
    logger.info(
      { event: "sync.worker_started", cron: DAILY_CRON, tz: TIME_ZONE },
      "fila de sincronização ligada",
    );
  })();
  return globalForBoss.fintrackWorker;
}
