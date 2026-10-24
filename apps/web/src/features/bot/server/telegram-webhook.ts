// O webhook do Telegram (M12.0b, ADR-019): a ÚNICA rota pública nova do segundo canal
// (app/api/telegram/webhook/route.ts só chama esta função). O Telegram chama aqui.
//
//   POST  cada update: confere o segredo do cabeçalho X-Telegram-Bot-Api-Secret-Token (o mesmo do
//         setWebhook) ANTES de ler o corpo, lê o corpo cru até 64 KB, grava as mensagens (uma vez
//         só por update), põe na fila e responde 200 na hora
//
// Como no WhatsApp, a resposta não ensina nada a quem não é o Telegram: segredo errado, corpo
// grande demais, JSON torto e update desconhecido respondem igual (200, "ok"); o motivo fica só no
// log (sem o corpo). Sem a configuração do Telegram, a rota responde 404, como se não existisse.
import "server-only";
import { prisma, recordIncoming } from "@fintrack/db";
import { botSecrets } from "@/lib/bot/secrets";
import { logger } from "@/lib/logger";
import { telegramConfig } from "@/lib/telegram/config";
import {
  parseUpdate,
  SECRET_HEADER,
  TELEGRAM_WEBHOOK_MAX_BYTES,
  validSecret,
} from "@/lib/telegram/protocol";
import { enqueueBotMessage } from "./jobs";
import { readLimited } from "./read-limited";

const NOT_FOUND = () => new Response("Not Found", { status: 404 });
const OK = () => new Response("ok", { status: 200, headers: { "content-type": "text/plain" } });

export async function handleTelegramWebhookPost(request: Request): Promise<Response> {
  const config = telegramConfig();
  const secrets = botSecrets();
  if (!config || !secrets) return NOT_FOUND();
  // O segredo ANTES de ler o corpo: quem não tem o segredo nem é lido
  if (!validSecret(request.headers.get(SECRET_HEADER), config.webhookSecret)) {
    logger.warn(
      { event: "webhook.rejected", channel: "telegram", reason: "secret" },
      "webhook recusado",
    );
    return OK();
  }
  const raw = await readLimited(request, TELEGRAM_WEBHOOK_MAX_BYTES);
  if (raw === null) {
    logger.warn(
      { event: "webhook.rejected", channel: "telegram", reason: "too_large" },
      "webhook recusado",
    );
    return OK();
  }
  let body: unknown;
  try {
    body = JSON.parse(Buffer.from(raw).toString("utf8"));
  } catch {
    logger.warn(
      { event: "webhook.rejected", channel: "telegram", reason: "json" },
      "webhook recusado",
    );
    return OK();
  }
  const messages = parseUpdate(body);
  let queued = 0;
  let duplicates = 0;
  for (const message of messages) {
    const recorded = await recordIncoming(prisma, secrets, message);
    if (recorded.duplicate) duplicates += 1;
    if (recorded.queue) {
      await enqueueBotMessage(recorded.queue);
      queued += 1;
    }
  }
  // Só contagens: nada da conversa, do texto ou do id do update
  logger.info(
    {
      event: "webhook.received",
      channel: "telegram",
      messages: messages.length,
      queued,
      duplicates,
    },
    "webhook do Telegram",
  );
  return OK();
}
