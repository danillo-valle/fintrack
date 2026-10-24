// O canal do bot pela WhatsApp Cloud API (M11, ADR-018): a única peça do app que fala com a Meta.
// Implementa o contrato `BotChannel` do core; a leitura, o vínculo e a confirmação não sabem que
// existe WhatsApp. Nos testes, o mesmo código fala com a Cloud API de mentira (WHATSAPP_API_URL).
//
// Nunca vai para o log: o token, o número de quem recebe e o texto da resposta.
import "server-only";
import type { BotChannel, BotIncomingRef, BotMessage } from "@fintrack/core";
import { ChannelError } from "@/lib/bot/channel-error";
import { botConfig, type BotConfig } from "./config";
import { metaErrorOf, outgoingMessage, readReceipt, type MetaError } from "./protocol";

export { ChannelError };

/** Cada chamada à Meta: 10 s no máximo (a fila tenta de novo a mensagem inteira, não a resposta). */
export const SEND_TIMEOUT_MS = 10_000;

/** A maior resposta de erro que o canal lê (a da Meta tem algumas centenas de bytes). */
const ERROR_BODY_MAX = 16 * 1024;

/** O código do erro no corpo de uma resposta recusada (corpo grande ou torto: sem código). */
async function errorOf(response: Response): Promise<MetaError> {
  try {
    const text = await response.text();
    return metaErrorOf(text.length <= ERROR_BODY_MAX ? JSON.parse(text) : null);
  } catch {
    return metaErrorOf(null);
  }
}

export function cloudApiChannel(config: BotConfig): BotChannel {
  const post = async (payload: unknown) => {
    // new URL com a base terminando em "/": "https://graph.facebook.com/v26.0/" + "<id>/messages"
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
    if (!response.ok) throw new ChannelError(response.status, await errorOf(response));
  };
  return {
    // O WhatsApp não edita a mensagem do botão: a resposta é sempre uma mensagem nova
    send: (to: string, message: BotMessage) => post(outgoingMessage(to, message)),
    acknowledge: (incoming: BotIncomingRef) => post(readReceipt(incoming.externalId)),
    // A Cloud API não apaga a mensagem da pessoa
    discard: async () => {},
  };
}

/** O canal configurado, ou null quando o bot está desligado no servidor. */
export function configuredChannel(): BotChannel | null {
  const config = botConfig();
  return config ? cloudApiChannel(config) : null;
}
