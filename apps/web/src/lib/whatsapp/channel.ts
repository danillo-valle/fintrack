// O canal do bot pela WhatsApp Cloud API (M11, ADR-018): a única peça do app que fala com a Meta.
// Implementa o contrato `BotChannel` do core; a leitura, o vínculo e a confirmação não sabem que
// existe WhatsApp. Nos testes, o mesmo código fala com a Cloud API de mentira (WHATSAPP_API_URL).
//
// Nunca vai para o log: o token, o número de quem recebe e o texto da resposta.
import "server-only";
import type { BotChannel, BotMessage } from "@fintrack/core";
import { botConfig, type BotConfig } from "./config";
import { outgoingMessage, readReceipt } from "./protocol";

/** Cada chamada à Meta: 10 s no máximo (a fila tenta de novo a mensagem inteira, não a resposta). */
export const SEND_TIMEOUT_MS = 10_000;

export class ChannelError extends Error {
  constructor(readonly status: number) {
    super(`a Cloud API respondeu ${status}`);
    this.name = "ChannelError";
  }
}

export function cloudApiChannel(config: BotConfig): BotChannel {
  const post = async (payload: unknown) => {
    // new URL com a base terminando em "/": "https://graph.facebook.com/v23.0/" + "<id>/messages"
    const base = config.apiUrl.endsWith("/") ? config.apiUrl : `${config.apiUrl}/`;
    const response = await fetch(new URL(`${config.phoneNumberId}/messages`, base), {
      method: "POST",
      headers: {
        authorization: `Bearer ${config.accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
      cache: "no-store",
    });
    if (!response.ok) throw new ChannelError(response.status);
  };
  return {
    send: (to: string, message: BotMessage) => post(outgoingMessage(to, message)),
    markRead: (wamid: string) => post(readReceipt(wamid)),
  };
}

/** O canal configurado, ou null quando o bot está desligado no servidor. */
export function configuredChannel(): BotChannel | null {
  const config = botConfig();
  return config ? cloudApiChannel(config) : null;
}
