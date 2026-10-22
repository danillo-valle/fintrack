// A fila do bot do WhatsApp (M11, ADR-018):
//
//   bot-message   cada mensagem que o webhook gravou. Lê (processBotMessage: toma a mensagem,
//                 decide e grava), marca como lida no WhatsApp e manda as respostas, cada uma
//                 depois de reservar o lugar na conta das grátis do mês
//   bot-daily     todo dia às 03:45: apaga as mensagens com mais de 90 dias
//
// O webhook nunca espera nada disto: ele grava, põe na fila e responde 200 na hora.
import "server-only";
import {
  BOT_WARNING_MESSAGE,
  prisma,
  processBotMessage,
  purgeBotMessages,
  reserveReply,
  type BotProcessResult,
} from "@fintrack/db";
import type { BotChannel } from "@fintrack/core";
import { financeChangedInBackground } from "@/lib/finance-cache";
import { jobs, QUEUES, TIME_ZONE } from "@/lib/jobs";
import { logger } from "@/lib/logger";
import { cascadeServices, QUEUE_SUBJECT } from "@/lib/ml/classifier";
import { botConfig, botSecrets } from "@/lib/whatsapp/config";
import { cloudApiChannel } from "@/lib/whatsapp/channel";

export const BOT_QUEUE = QUEUES.botMessage.name;
export const BOT_DAILY_QUEUE = QUEUES.botDaily.name;
/** 03:45 em São Paulo: depois do backup das 03:30 */
export const BOT_DAILY_CRON = "45 3 * * *";

export type BotJob = { messageId: string };

/** Põe a mensagem gravada na fila (o webhook chama). */
export async function enqueueBotMessage(messageId: string): Promise<void> {
  const boss = await jobs();
  await boss.send(BOT_QUEUE, { messageId } satisfies BotJob);
}

/**
 * Manda as respostas de UMA mensagem já lida: "lida" primeiro (de graça), depois cada resposta,
 * se couber na conta do mês. Falha da Meta numa resposta: conta e segue (a mensagem já foi
 * tomada; a proposta continua em Recebidos, na web).
 */
export async function deliver(
  channel: BotChannel,
  phoneNumberId: string,
  result: BotProcessResult,
  now: Date = new Date(),
): Promise<{ sent: number; skipped: number; failed: number }> {
  let sent = 0;
  let skipped = 0;
  let failed = 0;
  await channel.markRead(result.wamid).catch(() => {
    failed += 1;
  });
  for (const reply of result.replies) {
    const slot = await reserveReply(prisma, phoneNumberId, reply.kind, now);
    if (!slot.allowed) {
      skipped += 1;
      continue;
    }
    try {
      await channel.send(reply.to, reply.message);
      sent += 1;
      if (slot.warn) {
        await channel.send(reply.to, BOT_WARNING_MESSAGE);
        sent += 1;
      }
    } catch {
      failed += 1;
    }
  }
  return { sent, skipped, failed };
}

/** O que o worker faz com uma tarefa da fila. */
export async function processBotJob(job: BotJob, now: Date = new Date()): Promise<void> {
  const config = botConfig();
  const secrets = botSecrets();
  if (!config || !secrets) return; // desligado no servidor: a mensagem espera (some em 90 dias)
  const result = await processBotMessage(
    prisma,
    { ...secrets, services: cascadeServices(QUEUE_SUBJECT) },
    job.messageId,
    now,
  );
  if (!result) return; // já lida (repetição da fila)
  // Confirmar e Desfazer mudam o dinheiro: o painel do lar recalcula na próxima leitura
  const refreshed = result.financeChangedFor
    ? financeChangedInBackground(result.financeChangedFor)
    : null;
  const delivery = await deliver(cloudApiChannel(config), config.phoneNumberId, result, now);
  // Só o resultado e as contagens: nada do texto, do número ou do lançamento
  logger.info(
    { event: "bot.message", outcome: result.outcome, refreshed, ...delivery },
    "mensagem do bot lida",
  );
}

/** Liga o worker do bot e a limpeza diária (uma vez por processo). */
const globalForBotWorker = globalThis as unknown as { fintrackBotWorker?: Promise<void> };

export function startBotWorker(): Promise<void> {
  globalForBotWorker.fintrackBotWorker ??= (async () => {
    const boss = await jobs();
    await boss.work<BotJob>(BOT_QUEUE, { batchSize: 1 }, async ([job]) => {
      if (job) await processBotJob(job.data);
    });
    await boss.work(BOT_DAILY_QUEUE, async () => {
      const removed = await purgeBotMessages(prisma);
      logger.info({ event: "bot.purged", removed }, "limpeza das mensagens do bot");
    });
    await boss.schedule(BOT_DAILY_QUEUE, BOT_DAILY_CRON, null, { tz: TIME_ZONE });
    logger.info(
      { event: "bot.worker_started", configured: botConfig() !== null },
      "fila do bot do WhatsApp ligada",
    );
  })();
  return globalForBotWorker.fintrackBotWorker;
}
