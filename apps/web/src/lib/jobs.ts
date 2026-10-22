// A fila de tarefas do app (pg-boss, M09.1): as tarefas ficam numa tabela do próprio Postgres
// (esquema "pgboss"), então nenhum serviço novo precisa subir. Um pg-boss por processo, com todas
// as filas criadas aqui, num lugar só (M11: a fila do bot entrou ao lado das do banco).
//
//   bank-sync, bank-sync-daily, classifier-train-daily, local-ai-nightly   features/bank/server/jobs.ts
//   bot-message, bot-daily                                                features/bot/server/jobs.ts
//
// Quem executa: os workers de cada feature, que sobem junto com o servidor do app
// (instrumentation.ts) quando SYNC_WORKER=on.
import "server-only";
import { PgBoss, type Queue } from "pg-boss";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";

export const TIME_ZONE = "America/Sao_Paulo";

type QueueOptions = Omit<Queue, "name">;

/** Todas as filas do app e como cada uma se comporta. */
export const QUEUES = {
  /** Uma busca de UMA conexão com o banco; nunca duas da mesma conexão ao mesmo tempo */
  bankSync: {
    name: "bank-sync",
    options: {
      policy: "stately",
      retryLimit: 2,
      retryDelay: 60,
      retryBackoff: true,
      expireInSeconds: 15 * 60,
    },
  },
  bankSyncDaily: { name: "bank-sync-daily", options: { policy: "stately" } },
  classifierTraining: {
    name: "classifier-train-daily",
    options: { policy: "stately", expireInSeconds: 60 * 60 },
  },
  /** Uma rodada por vez; ela mesma para às 06:40 (o pg-boss só corta depois de 2 h) */
  localAi: {
    name: "local-ai-nightly",
    options: { policy: "stately", expireInSeconds: 2 * 60 * 60 },
  },
  /**
   * M11: cada mensagem do WhatsApp que o webhook gravou. Sem nova tentativa: a mensagem é tomada
   * antes de qualquer efeito, então repetir não faria nada (a proposta fica em Recebidos)
   */
  botMessage: {
    name: "bot-message",
    options: { policy: "standard", retryLimit: 0, expireInSeconds: 5 * 60 },
  },
  /** M11: a limpeza diária das mensagens com mais de 90 dias */
  botDaily: { name: "bot-daily", options: { policy: "stately" } },
} as const satisfies Record<string, { name: string; options: QueueOptions }>;

const globalForBoss = globalThis as unknown as { fintrackBoss?: Promise<PgBoss> };

/** O pg-boss do processo (um só, mesmo com o recarregamento do `pnpm dev`), com as filas criadas. */
export function jobs(): Promise<PgBoss> {
  globalForBoss.fintrackBoss ??= (async () => {
    const boss = new PgBoss({ connectionString: env.DATABASE_URL, schema: "pgboss" });
    boss.on("error", (error: unknown) =>
      logger.error({ event: "jobs.error", err: error }, "erro na fila de tarefas"),
    );
    await boss.start();
    const existing = new Set((await boss.getQueues()).map((q) => q.name));
    for (const queue of Object.values(QUEUES)) {
      if (!existing.has(queue.name)) await boss.createQueue(queue.name, queue.options);
    }
    return boss;
  })();
  return globalForBoss.fintrackBoss;
}
