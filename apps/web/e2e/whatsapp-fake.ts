// A WhatsApp Cloud API de mentira (M11, ADR-018): faz o papel da Meta nos testes, no CI e em
// casa, sem nada sair da máquina. Só escuta em 127.0.0.1. Nenhum teste fala com a Meta de verdade.
//
//   pnpm whatsapp:fake          (porta 8789; WHATSAPP_FAKE_PORT muda)
//
// O que ela faz:
//   POST /<versão>/<id do número>/messages   recebe as respostas do app como a Graph API (confere o
//                                           token e o id do número) e guarda para os testes lerem
//   POST /__enviar   {de, texto?, botao?, wamid?}   faz o papel da PESSOA: monta o JSON da Meta,
//                    assina com a chave secreta do app e chama o webhook do app
//                    (a mesma wamid de novo = a reentrega da Meta)
//   GET  /__respostas?para=5541…   as respostas que o app mandou para aquele número
//   GET  /health
//
// Os números de telefone dos testes são inventados (+55 41 90000-0001...).
import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage } from "node:http";
import { signatureFor } from "../src/lib/whatsapp/protocol";

try {
  process.loadEnvFile("../../.env");
} catch {
  // sem .env (CI): as variáveis vêm do ambiente
}

const port = Number.parseInt(process.env.WHATSAPP_FAKE_PORT ?? "8789", 10);
const appUrl = process.env.WHATSAPP_FAKE_APP_URL ?? "http://localhost:3000";
const appSecret = process.env.WHATSAPP_APP_SECRET ?? "";
const accessToken = process.env.WHATSAPP_ACCESS_TOKEN ?? "";
const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID ?? "";

type Sent = { at: string; to: string | null; payload: Record<string, unknown> };
const sent: Sent[] = [];
let seq = 0;

async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? (JSON.parse(text) as Record<string, unknown>) : {};
}

function metaBody(from: string, wamid: string, text?: string, button?: string) {
  const message: Record<string, unknown> = {
    from,
    id: wamid,
    timestamp: String(Math.floor(Date.now() / 1000)),
  };
  if (button) {
    message.type = "interactive";
    message.interactive = { type: "button_reply", button_reply: { id: button, title: "botão" } };
  } else {
    message.type = "text";
    message.text = { body: text ?? "" };
  }
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "200000000000001",
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: { display_phone_number: "15550100000", phone_number_id: phoneNumberId },
              contacts: [{ profile: { name: "Pessoa de teste" }, wa_id: from }],
              messages: [message],
            },
          },
        ],
      },
    ],
  };
}

const server = createServer((request, response) => {
  void (async () => {
    const url = new URL(request.url ?? "/", `http://127.0.0.1:${port}`);
    const json = (status: number, body: unknown) => {
      response.writeHead(status, { "content-type": "application/json" });
      response.end(JSON.stringify(body));
    };

    if (request.method === "GET" && url.pathname === "/health") return json(200, { ok: true });

    if (request.method === "GET" && url.pathname === "/__respostas") {
      const to = url.searchParams.get("para");
      return json(
        200,
        sent.filter((s) => !to || s.to === to),
      );
    }

    if (request.method === "POST" && url.pathname === "/__enviar") {
      const input = await readJson(request);
      const from = String(input.de ?? "");
      const wamid = typeof input.wamid === "string" ? input.wamid : `wamid.fake.${randomUUID()}`;
      const raw = JSON.stringify(
        metaBody(from, wamid, input.texto as string | undefined, input.botao as string | undefined),
      );
      // A assinatura pode ser estragada de propósito (o teste da assinatura recusada)
      const signature =
        input.assinatura === "errada"
          ? signatureFor(raw, "outra-chave-qualquer-0000")
          : signatureFor(raw, appSecret);
      const reply = await fetch(new URL("/api/whatsapp/webhook", appUrl), {
        method: "POST",
        headers: { "content-type": "application/json", "x-hub-signature-256": signature },
        body: raw,
      });
      return json(200, { wamid, status: reply.status });
    }

    // A Graph API: POST /v23.0/<id>/messages
    const graph = /^(?:\/v\d+\.\d+)?\/(\d+)\/messages$/.exec(url.pathname);
    if (request.method === "POST" && graph) {
      if (request.headers.authorization !== `Bearer ${accessToken}`)
        return json(401, { error: { message: "Invalid OAuth access token", code: 190 } });
      if (graph[1] !== phoneNumberId)
        return json(400, { error: { message: "Unsupported post request", code: 100 } });
      const payload = await readJson(request);
      if (payload.status === "read") {
        sent.push({ at: new Date().toISOString(), to: null, payload });
        return json(200, { success: true });
      }
      const to = typeof payload.to === "string" ? payload.to : null;
      sent.push({ at: new Date().toISOString(), to, payload });
      seq += 1;
      return json(200, {
        messaging_product: "whatsapp",
        contacts: [{ input: to, wa_id: to }],
        messages: [{ id: `wamid.resposta.${seq}` }],
      });
    }

    return json(404, { error: { message: "rota desconhecida na Cloud API de mentira" } });
  })().catch(() => {
    response.writeHead(500);
    response.end();
  });
});

server.listen(port, "127.0.0.1", () =>
  process.stdout.write(`Cloud API do WhatsApp de mentira em http://127.0.0.1:${port}\n`),
);
