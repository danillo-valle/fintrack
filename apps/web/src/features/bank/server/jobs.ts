// A fila da sincronização com o banco (M09.1, ADR-011), com o pg-boss (lib/jobs.ts: um pg-boss
// por processo e todas as filas do app criadas num lugar só).
//
//   bank-sync         uma busca de UMA conexão. singletonKey = id da conexão: nunca duas
//                     buscas da mesma conexão na fila ao mesmo tempo (política "stately")
//   bank-sync-daily   a agenda: todo dia às 04:30 (São Paulo), depois do backup das 03:30,
//                     põe na fila uma busca de cada conexão pronta (era 06:47 até o M10.2b:
//                     mudou para a IA local ter a carga da noite a tempo)
//   classifier-train-daily  (M10.1, ADR-015) todo dia às 03:15: treina o classificador de cada
//                     carteira cujos exemplos mudaram e preenche os recebidos sem categoria
//   local-ai-nightly  (M10.2b, ADR-016) a cada 10 min das 04:00 às 06:50, mas só trabalha na
//                     janela 04:45–06:40: pergunta à IA local pelo que as cargas deixaram sem
//                     categoria. Fora da janela, ou com a IA fora do ar, não faz nada
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
  runLocalAiNight,
  runSync,
  trainWallets,
  walletsForTraining,
} from "@fintrack/db";
import { inLocalAiWindow, localAiWindowEnd } from "@fintrack/core";
import { jobs, QUEUES, TIME_ZONE } from "@/lib/jobs";
import { logger } from "@/lib/logger";
import { cascadeServices, classifierPort, QUEUE_SUBJECT } from "@/lib/ml/classifier";
import { localAiPort } from "@/lib/ml/local-ai";
import { pluggyFor } from "./provider";

export { TIME_ZONE } from "@/lib/jobs";
export const SYNC_QUEUE = QUEUES.bankSync.name;
export const DAILY_QUEUE = QUEUES.bankSyncDaily.name;
/** 04:30 em São Paulo: depois do backup (03:30), e antes da IA local subir (04:40) */
export const DAILY_CRON = "30 4 * * *";
export const CLASSIFIER_QUEUE = QUEUES.classifierTraining.name;
/** 03:15 em São Paulo: a casa dorme, e o treino termina antes do backup das 03:30 */
export const CLASSIFIER_CRON = "15 3 * * *";
export const LOCAL_AI_QUEUE = QUEUES.localAi.name;
/** A cada 10 min das 04:00 às 06:50; a tarefa confere a janela (04:45–06:40) antes de trabalhar */
export const LOCAL_AI_CRON = "*/10 4-6 * * *";
const RETRIABLE = new Set(["PROVIDER_UNAVAILABLE", "PROVIDER_RATE_LIMITED", "SYNC_FAILED"]);

export type SyncJob = {
  connectionId: string;
  trigger: "SCHEDULED" | "MANUAL";
  requestedById: string | null;
};

const globalForWorker = globalThis as unknown as { fintrackWorker?: Promise<void> };

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

/**
 * Uma rodada da IA local (a cada 10 min na madrugada). Fora da janela, sem o serviço, ou com o
 * llama-server fora do ar: não faz nada. Para às 06:40 (o container desce às 06:45). Só
 * contagens no log: nenhuma descrição, nenhum nome de categoria.
 */
export async function processLocalAiNight(now: Date = new Date()): Promise<void> {
  if (!inLocalAiWindow(now)) return;
  const port = localAiPort(QUEUE_SUBJECT);
  if (!port) return;
  const night = await runLocalAiNight(prisma, port, { deadline: localAiWindowEnd(now) });
  logger.info(
    {
      event: "local_ai.night",
      status: night.status,
      households: night.households,
      asked: night.asked,
      applied: night.applied,
      ...night.outcomes,
    },
    "rodada da IA local",
  );
}

/** Liga o worker e a agenda diária (uma vez por processo). */
export function startSyncWorker(): Promise<void> {
  globalForWorker.fintrackWorker ??= (async () => {
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
    await boss.work(LOCAL_AI_QUEUE, async () => processLocalAiNight());
    await boss.schedule(LOCAL_AI_QUEUE, LOCAL_AI_CRON, null, { tz: TIME_ZONE });
    logger.info(
      {
        event: "sync.worker_started",
        cron: DAILY_CRON,
        classifierCron: CLASSIFIER_CRON,
        localAiCron: LOCAL_AI_CRON,
        tz: TIME_ZONE,
      },
      "fila de sincronização, do classificador e da IA local ligada",
    );
  })();
  return globalForWorker.fintrackWorker;
}
