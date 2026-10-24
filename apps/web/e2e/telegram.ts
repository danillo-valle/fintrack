// O bot do Telegram nos testes (M12.0b): os valores do Telegram de mentira (os mesmos do
// .env.example) e o papel da pessoa que escreve para o bot. Nenhum teste fala com o Telegram.
// Ids de conversa inventados (7000 + 2 dígitos do teste + 1 do aparelho), um por teste e aparelho.
import { expect } from "@playwright/test";

// Os valores abaixo são de mentira (os mesmos do .env.example) e só valem para o Telegram de
// mentira em 127.0.0.1: o "gitleaks:allow" diz ao gitleaks que não são segredos de verdade.
export const TELEGRAM_FAKE = {
  url: "http://127.0.0.1:8790",
  token: "1000000001:token-de-mentira-do-telegram-000001", // gitleaks:allow
  webhookSecret: "segredo-de-mentira-do-telegram-0000000001", // gitleaks:allow
  botUsername: "FinTrackExemploBot",
} as const;

/** Uma conversa inventada por teste e aparelho. */
export function fakeChat(test: number, project: string): string {
  return `7000${String(test).padStart(2, "0")}${project === "celular" ? 2 : 1}`;
}

/** A pessoa manda uma mensagem (ou toca num botão de uma mensagem do bot). Devolve o update_id. */
export async function sendToTelegram(input: {
  chat: string;
  text?: string;
  /** O toque: o callback_data do botão (como o app mandou) e a mensagem do bot que o tem */
  button?: { data: string; messageId: number };
  badSecret?: boolean;
}): Promise<number> {
  const response = await fetch(`${TELEGRAM_FAKE.url}/__enviar`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      chat: input.chat,
      texto: input.text,
      botao: input.button?.data,
      mensagem: input.button?.messageId,
      segredo: input.badSecret ? "errado" : undefined,
    }),
  });
  const body = (await response.json()) as { status: number; update_id: number };
  expect(body.status, "o webhook sempre responde 200 ao Telegram").toBe(200);
  return body.update_id;
}

export type TelegramMessage = {
  id: number;
  from: "pessoa" | "bot";
  text: string;
  buttons: { text: string; callback_data: string }[];
  edited: boolean;
  deleted: boolean;
};

/** A conversa como estaria no celular (mensagens editadas e apagadas). */
export async function conversation(chat: string): Promise<TelegramMessage[]> {
  const response = await fetch(`${TELEGRAM_FAKE.url}/__conversa?chat=${chat}`);
  return (await response.json()) as TelegramMessage[];
}

/** Espera uma mensagem do bot (viva) que case. A fila roda em segundo plano. */
export async function waitForBot(chat: string, match: RegExp): Promise<TelegramMessage> {
  let found: TelegramMessage | undefined;
  await expect
    .poll(
      async () => {
        found = (await conversation(chat)).findLast(
          (m) => m.from === "bot" && !m.deleted && match.test(m.text),
        );
        return found !== undefined;
      },
      { timeout: 20_000, intervals: [250, 500, 1000] },
    )
    .toBe(true);
  return found!;
}
