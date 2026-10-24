// O protocolo da WhatsApp Cloud API (M11, ADR-018), sem rede: a assinatura do webhook, a leitura
// do JSON que a Meta manda e o JSON que o FinTrack manda de volta. Funções puras, testadas sem
// subir nada (protocol.test.ts) e usadas pelo webhook, pelo canal e pela Cloud API de mentira.
//
// O que a Meta manda (só o que importa aqui):
//   { "object": "whatsapp_business_account",
//     "entry": [{ "changes": [{ "field": "messages", "value": {
//       "metadata": { "phone_number_id": "…" },
//       "messages": [{ "from": "5541…", "id": "wamid.…", "timestamp": "1761…",
//                      "type": "text", "text": { "body": "gastei 42,90 no mercado" } }],
//       "statuses": [ … ]   ← entregue/lida das NOSSAS respostas: ignorados
//     }}]}]}
import { createHmac, timingSafeEqual } from "node:crypto";
import type { BotMessage } from "@fintrack/core";
import type { IncomingBotMessage } from "@fintrack/db";

/** O maior corpo que o webhook aceita. Uma mensagem de texto tem alguns KB; 64 KB é folga. */
export const WEBHOOK_MAX_BYTES = 64 * 1024;

/**
 * Confere o cabeçalho X-Hub-Signature-256 ("sha256=<hex>"): HMAC-SHA256 do corpo CRU com a chave
 * secreta do app. Comparação em tempo constante. Qualquer coisa fora do formato: false.
 */
export function validSignature(
  rawBody: Uint8Array,
  header: string | null,
  appSecret: string,
): boolean {
  if (!header) return false;
  const match = /^sha256=([0-9a-f]{64})$/i.exec(header.trim());
  if (!match) return false;
  const expected = createHmac("sha256", appSecret).update(rawBody).digest();
  const given = Buffer.from(match[1]!, "hex");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** O "sha256=…" de um corpo (a Cloud API de mentira assina como a Meta). */
export function signatureFor(rawBody: Uint8Array | string, appSecret: string): string {
  return `sha256=${createHmac("sha256", appSecret).update(rawBody).digest("hex")}`;
}

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const str = (value: unknown): string | null => (typeof value === "string" ? value : null);

/**
 * As mensagens de um corpo de webhook, só do NOSSO número (phone_number_id). Formato estranho,
 * status de entrega e eventos de outros campos: ignorados (lista vazia), nunca erro.
 */
export function parseWebhook(body: unknown, phoneNumberId: string): IncomingBotMessage[] {
  if (!isObject(body) || body.object !== "whatsapp_business_account") return [];
  const out: IncomingBotMessage[] = [];
  for (const entry of list(body.entry)) {
    if (!isObject(entry)) continue;
    for (const change of list(entry.changes)) {
      if (!isObject(change) || change.field !== "messages" || !isObject(change.value)) continue;
      const value = change.value;
      const metadata = isObject(value.metadata) ? value.metadata : {};
      if (str(metadata.phone_number_id) !== phoneNumberId) continue;
      for (const message of list(value.messages)) {
        const parsed = parseMessage(message);
        if (parsed) out.push(parsed);
      }
    }
  }
  return out;
}

function parseMessage(message: unknown): IncomingBotMessage | null {
  if (!isObject(message)) return null;
  const wamid = str(message.id);
  const from = str(message.from);
  const timestamp = str(message.timestamp);
  if (!wamid || wamid.length > 200 || !from || !/^\d{8,15}$/.test(from)) return null;
  const seconds = timestamp && /^\d{1,12}$/.test(timestamp) ? Number.parseInt(timestamp, 10) : null;
  const sentAt = seconds !== null ? new Date(seconds * 1000) : new Date();
  const type = str(message.type);
  if (type === "text" && isObject(message.text)) {
    const text = str(message.text.body);
    if (text !== null) return { wamid, from, kind: "TEXT", sentAt, text };
  }
  if (type === "interactive" && isObject(message.interactive)) {
    const reply = message.interactive.button_reply;
    const id = isObject(reply) ? str(reply.id) : null;
    if (id !== null) return { wamid, from, kind: "BUTTON", sentAt, buttonId: id };
  }
  // Áudio, foto, figurinha, localização, botão de template...: o bot só lê texto (por enquanto)
  return { wamid, from, kind: "OTHER", sentAt };
}

/** O JSON de uma resposta (texto simples ou com botões de resposta). */
export function outgoingMessage(to: string, message: BotMessage) {
  const body = message.header ? `*${message.header}*\n${message.body}` : message.body;
  if (!message.buttons || message.buttons.length === 0) {
    return {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to,
      type: "text",
      text: { body, preview_url: false },
    };
  }
  return {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to,
    type: "interactive",
    interactive: {
      type: "button",
      body: { text: body },
      action: {
        buttons: message.buttons.map((b) => ({
          type: "reply",
          reply: { id: b.id, title: b.title },
        })),
      },
    },
  };
}

/** O JSON que marca uma mensagem recebida como lida. */
export function readReceipt(wamid: string) {
  return { messaging_product: "whatsapp", status: "read", message_id: wamid };
}

/**
 * Os erros da Cloud API que o bot sabe explicar (o código vem em `error.code` da resposta). Só o
 * código e um nome curto vão para o log: a mensagem da Meta pode repetir o número de quem recebe.
 * Tabela completa: developers.facebook.com › WhatsApp › Error codes.
 */
export const META_ERROR_HINTS: Readonly<Record<number, string>> = {
  100: "parametro_invalido", // em geral, o WHATSAPP_PHONE_NUMBER_ID errado (o número no lugar do id)
  190: "token_invalido", // token vencido (o de teste dura 24 h) ou revogado
  131026: "nao_entregue", // a pessoa não pode receber (sem WhatsApp, versão antiga, bloqueou)
  131030: "fora_da_lista_de_teste", // número de teste: quem recebe precisa estar na lista (o "9")
  131037: "nome_de_exibicao_sem_aprovacao", // número fornecido pela Meta: o nome precisa ser aprovado (M12.0)
  131047: "fora_da_janela_24h", // passou de 24 h desde a mensagem da pessoa (resposta exige template)
  131056: "muitas_para_o_mesmo_numero", // limite de envio para o mesmo número
  130429: "limite_de_envio", // limite de mensagens por segundo do número
};

export type MetaError = { code: number | null; subcode: number | null; hint: string | null };

const whole = (value: unknown): number | null =>
  typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;

/**
 * O código do erro numa resposta da Graph API (`{"error": {"code": 131030, "error_subcode": …}}`).
 * Corpo estranho: tudo null. Nunca devolve a mensagem de texto da Meta.
 */
export function metaErrorOf(body: unknown): MetaError {
  const error = isObject(body) && isObject(body.error) ? body.error : {};
  const code = whole(error.code);
  return {
    code,
    subcode: whole(error.error_subcode),
    hint: code !== null ? (META_ERROR_HINTS[code] ?? null) : null,
  };
}
