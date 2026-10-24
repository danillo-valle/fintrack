// O canal do bot pelo Telegram (M12.0b, ADR-019): a única peça do app que fala com a Bot API.
// Implementa o contrato `BotChannel` do core, como o canal do WhatsApp. Nos testes, o mesmo código
// fala com o Telegram de mentira (TELEGRAM_API_URL).
//
// Nunca vai para o log: o token (ele vai no endereço da chamada), o id da conversa e o texto.
import "server-only";
import type { BotChannel, BotIncomingRef, BotMessage } from "@fintrack/core";
import { ChannelError } from "@/lib/bot/channel-error";
import type { TelegramConfig } from "./config";
import {
  answerCallbackCall,
  deleteMessageCall,
  editMessageCall,
  sendMessageCall,
  telegramErrorOf,
  type TelegramCall,
} from "./protocol";

/** Cada chamada ao Telegram: 10 s no máximo. */
export const TELEGRAM_TIMEOUT_MS = 10_000;

/** A maior resposta que o canal lê (as do Telegram têm poucos KB). */
const RESPONSE_MAX = 64 * 1024;

export function telegramChannel(config: TelegramConfig): BotChannel {
  const call = async ({ method, payload }: TelegramCall) => {
    // "./" na frente: sem ele, o "bot<id>:" do token seria lido como o esquema de um endereço
    const base = config.apiUrl.endsWith("/") ? config.apiUrl : `${config.apiUrl}/`;
    const response = await fetch(new URL(`./bot${config.token}/${method}`, base), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(TELEGRAM_TIMEOUT_MS),
      cache: "no-store",
    });
    let body: unknown = null;
    try {
      const text = await response.text();
      body = text.length <= RESPONSE_MAX ? JSON.parse(text) : null;
    } catch {
      body = null;
    }
    const ok =
      response.ok && typeof body === "object" && body !== null && "ok" in body && body.ok === true;
    if (!ok) throw new ChannelError(response.status, telegramErrorOf(body), "o Telegram");
  };
  return {
    async send(to: string, message: BotMessage, replace?: string | null) {
      if (!replace) return call(sendMessageCall(to, message));
      try {
        await call(editMessageCall(to, replace, message));
      } catch (err: unknown) {
        // Tocou duas vezes no mesmo botão: a mensagem já está assim
        if (err instanceof ChannelError && err.hint === "mensagem_igual") return;
        // A mensagem do botão não existe mais (a pessoa apagou): manda uma nova
        if (err instanceof ChannelError && err.hint === "mensagem_nao_encontrada")
          return call(sendMessageCall(to, message));
        throw err;
      }
    },
    async acknowledge(incoming: BotIncomingRef) {
      if (incoming.callbackId) await call(answerCallbackCall(incoming.callbackId));
    },
    async discard(incoming: BotIncomingRef) {
      if (incoming.messageId) await call(deleteMessageCall(incoming.chat, incoming.messageId));
    },
  };
}
