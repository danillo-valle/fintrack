// A fila do bot (M11, ADR-018; o Telegram no M12.0b, ADR-019):
//
//   bot-message   cada mensagem que o webhook (do WhatsApp ou do Telegram) gravou. Lê
//                 (processBotMessage: toma a mensagem, decide e grava), avisa o canal que leu e
//                 manda as respostas pelo canal de onde ela veio. No WhatsApp, cada resposta
//                 reserva antes o lugar na conta das grátis do mês; o Telegram não tem teto
//   bot-daily     todo dia às 03:45: apaga as mensagens com mais de 90 dias
//
// O webhook nunca espera nada disto: ele grava, põe na fila e responde 200 na hora.
import "server-only";
import {
  BOT_WARNING_MESSAGE,
  prisma,
  processBotMessage,
  purgeBotMessages,
  recordReplyResult,
  reserveReply,
  type BotProcessResult,
} from "@fintrack/db";
import type { BotChannel } from "@fintrack/core";
import { ChannelError } from "@/lib/bot/channel-error";
import { botSecrets } from "@/lib/bot/secrets";
import { financeChangedInBackground } from "@/lib/finance-cache";
import { jobs, QUEUES, TIME_ZONE } from "@/lib/jobs";
import { logger } from "@/lib/logger";
import { cascadeServices, QUEUE_SUBJECT } from "@/lib/ml/classifier";
import { telegramChannel } from "@/lib/telegram/channel";
import { telegramConfig } from "@/lib/telegram/config";
import { cloudApiChannel } from "@/lib/whatsapp/channel";
import { botConfig } from "@/lib/whatsapp/config";

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
 * O canal da mensagem, como a fila o usa: o contrato do core e, no WhatsApp, o número do bot (a
 * conta das respostas grátis). O Telegram não tem conta: `phoneNumberId` nulo.
 */
export type DeliveryChannel = { channel: BotChannel; phoneNumberId: string | null };

/**
 * Manda as respostas de UMA mensagem já lida: "lida" primeiro (de graça), a mensagem com número de
 * cartão para fora da conversa (Telegram), depois cada resposta (no WhatsApp, se couber na conta
 * do mês). Falha do canal numa resposta: conta e segue (a mensagem já foi tomada; a proposta
 * continua em Recebidos, na web).
 */
export async function deliver(
  { channel, phoneNumberId }: DeliveryChannel,
  result: BotProcessResult,
  now: Date = new Date(),
): Promise<{ sent: number; skipped: number; failed: number }> {
  let sent = 0;
  let skipped = 0;
  let failed = 0;
  const tag = result.channel === "TELEGRAM" ? "telegram" : "whatsapp";
  await channel.acknowledge(result.incoming).catch((err: unknown) => {
    failed += 1;
    logSendFailure(tag, "read", err);
  });
  if (result.discard)
    await channel.discard(result.incoming).catch((err: unknown) => {
      failed += 1;
      logSendFailure(tag, "discard", err);
    });
  for (const reply of result.replies) {
    const slot = phoneNumberId
      ? await reserveReply(prisma, phoneNumberId, reply.kind, now)
      : { allowed: true, warn: false };
    if (!slot.allowed) {
      skipped += 1;
      continue;
    }
    try {
      await channel.send(reply.to, reply.message, reply.replace);
      sent += 1;
      if (phoneNumberId) await recordReplyResult(prisma, phoneNumberId, { ok: true }, now);
      if (slot.warn) {
        await channel.send(reply.to, BOT_WARNING_MESSAGE);
        sent += 1;
      }
    } catch (err: unknown) {
      failed += 1;
      logSendFailure(tag, "reply", err);
      if (phoneNumberId)
        await recordReplyResult(
          prisma,
          phoneNumberId,
          { ok: false, code: err instanceof ChannelError ? err.code : null },
          now,
        );
    }
  }
  return { sent, skipped, failed };
}

/**
 * Uma resposta que o canal recusou: o status, o código do canal e o nome curto (131037 =
 * "nome_de_exibicao_sem_aprovacao"; a tabela está no runbook). Nunca o número, a conversa, o texto
 * ou a mensagem de erro do canal (ela pode repetir o número de quem recebe).
 */
function logSendFailure(channel: string, kind: "read" | "discard" | "reply", err: unknown) {
  const meta =
    err instanceof ChannelError
      ? { status: err.status, code: err.code, subcode: err.subcode, hint: err.hint }
      : { status: null, code: null, subcode: null, hint: err instanceof Error ? err.name : "erro" };
  logger.warn({ event: "bot.send_failed", channel, kind, ...meta }, "o canal recusou");
}

/** O canal de cada mensagem; nulo quando aquele canal não está configurado no servidor. */
function channelFor(result: BotProcessResult): DeliveryChannel | null {
  if (result.channel === "TELEGRAM") {
    const config = telegramConfig();
    return config ? { channel: telegramChannel(config), phoneNumberId: null } : null;
  }
  const config = botConfig();
  return config ? { channel: cloudApiChannel(config), phoneNumberId: config.phoneNumberId } : null;
}

/** O que o worker faz com uma tarefa da fila. */
export async function processBotJob(job: BotJob, now: Date = new Date()): Promise<void> {
  const secrets = botSecrets();
  if (!secrets) return; // desligado no servidor: a mensagem espera (some em 90 dias)
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
  const target = channelFor(result);
  const delivery = target
    ? await deliver(target, result, now)
    : { sent: 0, skipped: result.replies.length, failed: 0 };
  // Só o canal, o resultado e as contagens: nada do texto, do número ou do lançamento
  logger.info(
    {
      event: "bot.message",
      channel: result.channel === "TELEGRAM" ? "telegram" : "whatsapp",
      outcome: result.outcome,
      refreshed,
      ...delivery,
    },
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
      {
        event: "bot.worker_started",
        configured: botConfig() !== null,
        telegram: telegramConfig() !== null,
      },
      "fila do bot ligada",
    );
  })();
  return globalForBotWorker.fintrackBotWorker;
}
