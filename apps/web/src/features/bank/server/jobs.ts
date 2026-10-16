// A fila da sincronização com o banco (M09.1, ADR-011), com o pg-boss: as tarefas ficam numa
// tabela do próprio Postgres (esquema "pgboss"), então nenhum serviço novo precisa subir.
//
//   bank-sync         uma busca de UMA conexão. singletonKey = id da conexão: nunca duas
//                     buscas da mesma conexão na fila ao mesmo tempo (política "stately")
//   bank-sync-daily   a agenda: todo dia às 06:47 (São Paulo), depois do backup das 03:30,
//                     põe na fila uma busca de cada conexão pronta
//   classifier-train-daily  (M10.1, ADR-015) todo dia às 03:15: treina o classificador de cada
//                     carteira cujos exemplos mudaram e preenche os recebidos sem categoria
//
// Quem pede: o botão "Buscar agora" (Server Action) e a agenda. Quem executa: o worker, que
// sobe junto com o servidor do app (instrumentation.ts) quando SYNC_WORKER=on. A busca nunca
// roda dentro da requisição de quem apertou o botão.
//
// Falha passageira (Pluggy fora do ar, muitas chamadas): 2 novas tentativas, com espera
// crescente. Credencial recusada não tenta de novo: a pessoa precisa trocar o Client Secret.
import "server-only";
import {
  connectionsDueForSync,
  describeOutcome,
  prisma,
  runSync,
  trainWallets,
  walletsForTraining,
} from "@fintrack/db";
import { PgBoss } from "pg-boss";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { cascadeServices, classifierPort, QUEUE_SUBJECT } from "@/lib/ml/classifier";
import { pluggyFor } from "./provider";

export const SYNC_QUEUE = "bank-sync";
export const DAILY_QUEUE = "bank-sync-daily";
/** 06:47 em São Paulo: depois do backup (03:30) e do Meu Pluggy atualizar os bancos (madrugada) */
export const DAILY_CRON = "47 6 * * *";
export const TIME_ZONE = "America/Sao_Paulo";
export const CLASSIFIER_QUEUE = "classifier-train-daily";
/** 03:15 em São Paulo: a casa dorme, e o treino termina antes do backup das 03:30 */
export const CLASSIFIER_CRON = "15 3 * * *";
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
    if (!existing.has(CLASSIFIER_QUEUE)) {
      await boss.createQueue(CLASSIFIER_QUEUE, { policy: "stately", expireInSeconds: 60 * 60 });
    }
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
  const outcome = await runSync(prisma, {
    ...job,
    provider: () => pluggyFor(job.connectionId),
    // A cascata da busca também pergunta ao classificador (em nome da fila)
    services: cascadeServices(QUEUE_SUBJECT),
  });
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

/**
 * O treino da madrugada: todas as carteiras (as arquivadas perdem o modelo), uma por vez. Só
 * contagens no log: nenhuma descrição, nenhum nome de categoria.
 */
export async function processClassifierTraining(now: Date = new Date()): Promise<void> {
  const port = classifierPort(QUEUE_SUBJECT);
  if (!port) return; // sem ML_SERVICE_URL: nada a treinar
  const outcomes = await trainWallets(prisma, port, await walletsForTraining(prisma), now);
  const count = (status: string) => outcomes.filter((o) => o.status === status).length;
  logger.info(
    {
      event: "classifier.trained",
      wallets: outcomes.length,
      trained: count("TRAINED"),
      unchanged: count("UNCHANGED"),
      tooFew: count("TOO_FEW"),
      failed: count("FAILED"),
      filled: outcomes.reduce((sum, o) => sum + (o.status === "TRAINED" ? o.filled : 0), 0),
    },
    "treino do classificador",
  );
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
    await boss.work(CLASSIFIER_QUEUE, async () => processClassifierTraining());
    await boss.schedule(CLASSIFIER_QUEUE, CLASSIFIER_CRON, null, { tz: TIME_ZONE });
    logger.info(
      {
        event: "sync.worker_started",
        cron: DAILY_CRON,
        classifierCron: CLASSIFIER_CRON,
        tz: TIME_ZONE,
      },
      "fila de sincronização e do classificador ligada",
    );
  })();
  return globalForBoss.fintrackWorker;
}
