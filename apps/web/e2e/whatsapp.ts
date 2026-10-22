// O bot do WhatsApp nos testes (M11): os valores da Cloud API de mentira (os mesmos do
// .env.example) e o papel da pessoa que escreve para o bot. Nenhum teste fala com a Meta.
// Números de telefone inventados (+55 41 90000-01xx), um por teste e por aparelho.
import { expect } from "@playwright/test";

// Os três valores abaixo são de mentira (os mesmos do .env.example) e só valem para a Cloud API de
// mentira em 127.0.0.1: o "gitleaks:allow" diz ao gitleaks que não são segredos de verdade.
export const WHATSAPP_FAKE = {
  url: "http://127.0.0.1:8789",
  appSecret: "segredo-do-app-de-mentira-0001", // gitleaks:allow
  accessToken: "token-de-mentira-0000000000000001", // gitleaks:allow
  verifyToken: "verificacao-de-mentira-0001", // gitleaks:allow
  phoneNumberId: "100000000000001",
  displayNumber: "+1 555 010-0000",
} as const;

/** Um número inventado por teste e aparelho: 5541900000 + 2 dígitos do teste + 1 do aparelho. */
export function fakePhone(test: number, project: string): string {
  return `554190000${String(test).padStart(2, "0")}${project === "celular" ? 2 : 1}`;
}

/** A pessoa manda uma mensagem (ou clica num botão) para o bot. Devolve o wamid usado. */
export async function sendToBot(input: {
  from: string;
  text?: string;
  button?: string;
  wamid?: string;
  badSignature?: boolean;
}): Promise<string> {
  const response = await fetch(`${WHATSAPP_FAKE.url}/__enviar`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      de: input.from,
      texto: input.text,
      botao: input.button,
      wamid: input.wamid,
      assinatura: input.badSignature ? "errada" : undefined,
    }),
  });
  const body = (await response.json()) as { wamid: string; status: number };
  expect(body.status, "o webhook sempre responde 200 à Meta").toBe(200);
  return body.wamid;
}

type Sent = { to: string | null; payload: Record<string, unknown> };

/** As respostas que o bot mandou para o número (a Cloud API de mentira guarda). */
export async function repliesTo(phone: string): Promise<Sent[]> {
  const response = await fetch(`${WHATSAPP_FAKE.url}/__respostas?para=${phone}`);
  return (await response.json()) as Sent[];
}

/** O texto de uma resposta (o corpo, com ou sem botões). */
export function replyText(sent: Sent): string {
  const p = sent.payload as {
    text?: { body: string };
    interactive?: { body: { text: string } };
  };
  return p.text?.body ?? p.interactive?.body.text ?? "";
}

/** Os botões de uma resposta (id e título). */
export function replyButtons(sent: Sent): { id: string; title: string }[] {
  const p = sent.payload as {
    interactive?: { action: { buttons: { reply: { id: string; title: string } }[] } };
  };
  return p.interactive?.action.buttons.map((b) => b.reply) ?? [];
}

/** Espera o bot responder com um texto que case (a fila roda em segundo plano). */
export async function waitForReply(phone: string, match: RegExp): Promise<Sent> {
  let found: Sent | undefined;
  await expect
    .poll(
      async () => {
        found = (await repliesTo(phone)).findLast((s) => match.test(replyText(s)));
        return found !== undefined;
      },
      { timeout: 20_000, intervals: [250, 500, 1000] },
    )
    .toBe(true);
  return found!;
}
