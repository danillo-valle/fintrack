// O webhook do WhatsApp (M11, ADR-018): a ÚNICA rota pública nova do bot
// (app/api/whatsapp/webhook/route.ts só chama estas duas funções). A Meta chama aqui.
//
//   GET   a verificação do painel da Meta: hub.mode=subscribe e hub.verify_token igual ao nosso
//         (WHATSAPP_VERIFY_TOKEN) → devolve o hub.challenge
//   POST  cada evento: confere a assinatura X-Hub-Signature-256 sobre o corpo CRU antes de ler o
//         JSON, grava as mensagens (uma vez só por wamid), põe na fila e responde 200 na hora.
//         Nada de trabalho pesado aqui: a Meta reenvia o que não recebe 200 em poucos segundos
//
// Para quem não é a Meta, a resposta não ensina nada: assinatura errada, corpo grande demais,
// JSON torto e evento desconhecido respondem igual (200, "ok"); o motivo fica só no log (sem o
// corpo). Sem a configuração do bot, a rota responde 404, como se não existisse.
import "server-only";
import { timingSafeEqual } from "node:crypto";
import { prisma, recordIncoming } from "@fintrack/db";
import { enqueueBotMessage } from "./jobs";
import { logger } from "@/lib/logger";
import { botSecrets } from "@/lib/bot/secrets";
import { botConfig } from "@/lib/whatsapp/config";
import { readLimited } from "./read-limited";
import { parseWebhook, validSignature, WEBHOOK_MAX_BYTES } from "@/lib/whatsapp/protocol";

const NOT_FOUND = () => new Response("Not Found", { status: 404 });
const OK = () => new Response("ok", { status: 200, headers: { "content-type": "text/plain" } });

function sameText(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export async function handleWebhookGet(request: Request): Promise<Response> {
  const config = botConfig();
  if (!config) return NOT_FOUND();
  const params = new URL(request.url).searchParams;
  const challenge = params.get("hub.challenge") ?? "";
  if (
    params.get("hub.mode") === "subscribe" &&
    sameText(params.get("hub.verify_token") ?? "", config.verifyToken) &&
    /^[A-Za-z0-9_-]{1,100}$/.test(challenge)
  ) {
    logger.info({ event: "webhook.verified" }, "webhook do WhatsApp verificado pela Meta");
    return new Response(challenge, { status: 200, headers: { "content-type": "text/plain" } });
  }
  logger.warn({ event: "webhook.verify_refused" }, "verificação do webhook recusada");
  return new Response("Forbidden", { status: 403 });
}

export async function handleWebhookPost(request: Request): Promise<Response> {
  const config = botConfig();
  const secrets = botSecrets();
  if (!config || !secrets) return NOT_FOUND();
  const raw = await readLimited(request, WEBHOOK_MAX_BYTES);
  if (raw === null) {
    logger.warn({ event: "webhook.rejected", reason: "too_large" }, "webhook recusado");
    return OK();
  }
  // A assinatura ANTES de qualquer JSON.parse: corpo não assinado nem é lido
  if (!validSignature(raw, request.headers.get("x-hub-signature-256"), config.appSecret)) {
    logger.warn({ event: "webhook.rejected", reason: "signature" }, "webhook recusado");
    return OK();
  }
  let body: unknown;
  try {
    body = JSON.parse(Buffer.from(raw).toString("utf8"));
  } catch {
    logger.warn({ event: "webhook.rejected", reason: "json" }, "webhook recusado");
    return OK();
  }
  const messages = parseWebhook(body, config.phoneNumberId);
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
  // Só contagens: nada do número, do texto ou do wamid
  logger.info(
    { event: "webhook.received", messages: messages.length, queued, duplicates },
    "webhook do WhatsApp",
  );
  return OK();
}
