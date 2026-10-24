// O protocolo da Bot API do Telegram (M12.0b, ADR-019), sem rede: o segredo do webhook, a
// tradução do "update" do Telegram para a mensagem que o bot entende, o JSON das respostas e o
// código dos erros. O canal (channel.ts) e o webhook só chamam estas funções.
//
// Só conversas privadas entram: grupo, canal, mensagem editada e mensagem de outro bot são
// ignorados (o update responde "ok" e nada é gravado).
import { timingSafeEqual } from "node:crypto";
import type { BotMessage } from "@fintrack/core";
import type { IncomingBotMessage } from "@fintrack/db";
import type { ChannelFailure } from "@/lib/bot/channel-error";

/** O maior corpo que o webhook lê (um update de texto tem 1 a 2 KB). */
export const TELEGRAM_WEBHOOK_MAX_BYTES = 64 * 1024;

/** O cabeçalho em que o Telegram manda o segredo do setWebhook. */
export const SECRET_HEADER = "x-telegram-bot-api-secret-token";

/** O segredo do webhook confere? (tempo constante; ausente ou de outro tamanho: não) */
export function validSecret(header: string | null, expected: string): boolean {
  if (!header) return false;
  const left = Buffer.from(header);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

// ── O botão: o Telegram aceita até 64 bytes no callback_data ──────────────────────

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;
const PACKED = /^[cxukw](?::[A-Za-z0-9_-]{22}){1,2}$/;

/**
 * "k:<uuid>:<uuid>" (75 caracteres) cabe nos 64 bytes do Telegram com cada uuid em base64url
 * (22 caracteres): "k:<22>:<22>".
 */
export function packCallbackData(id: string): string {
  return id.replace(UUID, (uuid) =>
    Buffer.from(uuid.replaceAll("-", ""), "hex").toString("base64url"),
  );
}

/** O contrário de `packCallbackData`; qualquer coisa fora do formato: nulo. */
export function unpackCallbackData(data: string): string | null {
  if (!PACKED.test(data)) return null;
  const [kind, ...ids] = data.split(":");
  const uuids = ids.map((part) => {
    const hex = Buffer.from(part, "base64url").toString("hex");
    if (hex.length !== 32) return null;
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  });
  if (uuids.some((u) => u === null)) return null;
  return [kind, ...uuids].join(":");
}

// ── O update que chega ──────────────────────────────────────────────────────────

type Obj = Record<string, unknown>;
const isObj = (value: unknown): value is Obj =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const positiveInt = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value > 0;

/** A conversa privada da mensagem (o id é o da pessoa), ou nulo. */
function privateChat(message: unknown): { chat: string; messageId: string; date: number } | null {
  if (!isObj(message) || !isObj(message.chat) || !isObj(message.from)) return null;
  if (message.chat.type !== "private" || message.from.is_bot !== false) return null;
  if (!positiveInt(message.chat.id) || message.chat.id !== message.from.id) return null;
  if (!positiveInt(message.message_id) || !positiveInt(message.date)) return null;
  return {
    chat: String(message.chat.id),
    messageId: String(message.message_id),
    date: message.date,
  };
}

/**
 * Traduz um update do Telegram. Só a mensagem nova numa conversa privada (texto ou outra coisa) e
 * o toque num botão de uma mensagem do bot nessa conversa; o resto: nada.
 */
export function parseUpdate(body: unknown): IncomingBotMessage[] {
  if (!isObj(body) || !positiveInt(body.update_id)) return [];
  const wamid = `tg:${body.update_id}`;
  if (body.message !== undefined) {
    const chat = privateChat(body.message);
    if (!chat) return [];
    const text = (body.message as Obj).text;
    const base = {
      channel: "TELEGRAM" as const,
      wamid,
      from: chat.chat,
      sentAt: new Date(chat.date * 1000),
      messageId: chat.messageId,
    };
    return typeof text === "string"
      ? [{ ...base, kind: "TEXT", text }]
      : [{ ...base, kind: "OTHER" }];
  }
  if (isObj(body.callback_query)) {
    const query = body.callback_query;
    if (typeof query.id !== "string" || query.id.length === 0 || query.id.length > 64) return [];
    if (!isObj(query.from) || query.from.is_bot !== false) return [];
    // O toque é numa mensagem DO BOT na conversa privada com quem tocou
    const message = query.message;
    if (!isObj(message) || !isObj(message.chat) || message.chat.type !== "private") return [];
    if (!positiveInt(message.chat.id) || message.chat.id !== query.from.id) return [];
    if (!positiveInt(message.message_id)) return [];
    const action = typeof query.data === "string" ? unpackCallbackData(query.data) : null;
    return [
      {
        channel: "TELEGRAM",
        wamid,
        from: String(message.chat.id),
        kind: "BUTTON",
        sentAt: new Date(),
        // Botão que não é nosso: segue vazio e a fila responde que não vale (STALE)
        buttonId: action ?? "",
        callbackId: query.id,
        buttonMessageId: String(message.message_id),
      },
    ];
  }
  return [];
}

// ── As respostas ─────────────────────────────────────────────────────────────────

/** O texto da resposta: a linha do título em negrito (por entidade, sem marcação no texto). */
function textOf(message: BotMessage) {
  const text = message.header ? `${message.header}\n${message.body}` : message.body;
  const entities = message.header
    ? [{ type: "bold", offset: 0, length: message.header.length }]
    : [];
  // Os botões lado a lado, numa linha (no Telegram cabem); sem botões: o teclado some
  const keyboard = [
    (message.buttons ?? []).map((b) => ({
      text: b.title,
      callback_data: packCallbackData(b.id),
    })),
  ].filter((row) => row.length > 0);
  return { text, entities, reply_markup: { inline_keyboard: keyboard } };
}

export type TelegramCall = { method: string; payload: Obj };

/** Mandar uma resposta nova. */
export function sendMessageCall(chat: string, message: BotMessage): TelegramCall {
  return { method: "sendMessage", payload: { chat_id: chat, ...textOf(message) } };
}

/** Trocar a mensagem do bot que tinha o botão tocado (o Confirmar vira "Lançado"). */
export function editMessageCall(
  chat: string,
  messageId: string,
  message: BotMessage,
): TelegramCall {
  return {
    method: "editMessageText",
    payload: { chat_id: chat, message_id: Number(messageId), ...textOf(message) },
  };
}

/** Confirmar o toque (o reloginho do botão some). */
export function answerCallbackCall(callbackId: string): TelegramCall {
  return { method: "answerCallbackQuery", payload: { callback_query_id: callbackId } };
}

/** Tirar da conversa a mensagem da pessoa (a do número de cartão). */
export function deleteMessageCall(chat: string, messageId: string): TelegramCall {
  return { method: "deleteMessage", payload: { chat_id: chat, message_id: Number(messageId) } };
}

// ── Os erros ─────────────────────────────────────────────────────────────────────

/**
 * Nomes curtos para as recusas conhecidas do Telegram (a tabela do runbook). O texto do erro do
 * Telegram nunca vai para o log: dele só sai um destes nomes.
 */
const TELEGRAM_ERROR_HINTS: readonly [RegExp, string][] = [
  [/message is not modified/i, "mensagem_igual"],
  [
    /message to edit not found|message to delete not found|message can't be (edited|deleted)/i,
    "mensagem_nao_encontrada",
  ],
  [/bot was blocked by the user/i, "bloqueado_pela_pessoa"],
  [/chat not found|user is deactivated/i, "conversa_nao_encontrada"],
  [/query is too old|query id is invalid/i, "toque_vencido"],
  [/unauthorized/i, "token_invalido"],
  [/too many requests/i, "limite_de_envio"],
];

/** O código e o nome curto de uma recusa do Telegram ({"ok":false,"error_code":…}). */
export function telegramErrorOf(body: unknown): ChannelFailure {
  if (!isObj(body) || body.ok !== false) return { code: null, subcode: null, hint: null };
  const code = positiveInt(body.error_code) ? body.error_code : null;
  const description = typeof body.description === "string" ? body.description : "";
  const hint = TELEGRAM_ERROR_HINTS.find(([pattern]) => pattern.test(description))?.[1] ?? null;
  return { code, subcode: null, hint };
}
