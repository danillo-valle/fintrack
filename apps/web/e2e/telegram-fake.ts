// O Telegram de mentira (M12.0b, ADR-019): faz o papel da Bot API e da pessoa nos testes, no CI e
// em casa, sem nada sair da máquina. Só escuta em 127.0.0.1. Nenhum teste fala com o Telegram.
//
//   pnpm telegram:fake          (porta 8790; TELEGRAM_FAKE_PORT muda)
//
// O que ele faz:
//   POST /bot<token>/<método>   recebe as chamadas do app como a Bot API (confere o token):
//                               sendMessage, editMessageText, answerCallbackQuery, deleteMessage.
//                               Guarda a conversa como ela ficaria no celular (mensagens editadas
//                               e apagadas)
//   POST /__enviar   {chat, texto?, botao?, mensagem?, segredo?}   faz o papel da PESSOA: monta o
//                    update do Telegram (texto, ou o toque no botão com o callback_data `botao`
//                    da mensagem do bot `mensagem`) e chama o webhook do app com o segredo (ou com um errado)
//   GET  /__conversa?chat=7000…   a conversa: cada mensagem (da pessoa e do bot) como está agora
//   GET  /health
//
// Os ids de conversa dos testes são inventados (7000…).
import { createServer, type IncomingMessage } from "node:http";

try {
  process.loadEnvFile("../../.env");
} catch {
  // sem .env (CI): as variáveis vêm do ambiente
}

const port = Number.parseInt(process.env.TELEGRAM_FAKE_PORT ?? "8790", 10);
const appUrl = process.env.TELEGRAM_FAKE_APP_URL ?? "http://localhost:3000";
const token = process.env.TELEGRAM_BOT_TOKEN ?? "";
const secret = process.env.TELEGRAM_WEBHOOK_SECRET ?? "";

type Button = { text: string; callback_data: string };
type Message = {
  id: number;
  chat: string;
  from: "pessoa" | "bot";
  text: string;
  buttons: Button[];
  edited: boolean;
  deleted: boolean;
};
const messages: Message[] = [];
let seq = 1000;
// O update_id do Telegram só cresce: começa do relógio para não repetir o de uma rodada anterior
// (o mesmo update_id = a mesma mensagem para o webhook, que a ignoraria como repetida)
let updates = Math.floor(Date.now() / 1000) * 1000;

async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? (JSON.parse(text) as Record<string, unknown>) : {};
}

const buttonsOf = (payload: Record<string, unknown>): Button[] =>
  (
    (payload.reply_markup as { inline_keyboard?: Button[][] } | undefined)?.inline_keyboard ?? []
  ).flat();

const server = createServer((request, response) => {
  void (async () => {
    const url = new URL(request.url ?? "/", `http://127.0.0.1:${port}`);
    const json = (status: number, body: unknown) => {
      response.writeHead(status, { "content-type": "application/json" });
      response.end(JSON.stringify(body));
    };
    const fail = (status: number, description: string) =>
      json(status, { ok: false, error_code: status, description });

    if (request.method === "GET" && url.pathname === "/health") return json(200, { ok: true });

    if (request.method === "GET" && url.pathname === "/__conversa") {
      const chat = url.searchParams.get("chat");
      return json(
        200,
        messages.filter((m) => m.chat === chat),
      );
    }

    if (request.method === "POST" && url.pathname === "/__enviar") {
      const input = await readJson(request);
      const chat = Number.parseInt(String(input.chat ?? ""), 10);
      const person = { id: chat, is_bot: false, first_name: "Pessoa de teste" };
      const update_id = ++updates;
      let body: Record<string, unknown>;
      if (typeof input.botao === "string") {
        const target = Number(input.mensagem);
        body = {
          update_id,
          callback_query: {
            id: `cb-${update_id}`,
            from: person,
            data: input.botao,
            message: {
              message_id: target,
              date: Math.floor(Date.now() / 1000),
              chat: { id: chat, type: "private" },
            },
          },
        };
      } else {
        const id = ++seq;
        messages.push({
          id,
          chat: String(chat),
          from: "pessoa",
          text: String(input.texto ?? ""),
          buttons: [],
          edited: false,
          deleted: false,
        });
        body = {
          update_id,
          message: {
            message_id: id,
            date: Math.floor(Date.now() / 1000),
            chat: { id: chat, type: "private" },
            from: person,
            text: String(input.texto ?? ""),
          },
        };
      }
      const reply = await fetch(new URL("/api/telegram/webhook", appUrl), {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-telegram-bot-api-secret-token":
            input.segredo === "errado" ? "um-segredo-errado-qualquer-000000001" : secret,
        },
        body: JSON.stringify(body),
      });
      return json(200, { update_id, status: reply.status });
    }

    // A Bot API: POST /bot<token>/<método>
    const api = /^\/bot([^/]+)\/(\w+)$/.exec(url.pathname);
    if (request.method === "POST" && api) {
      if (decodeURIComponent(api[1]!) !== token) return fail(401, "Unauthorized");
      const payload = await readJson(request);
      const chat = String(payload.chat_id ?? "");
      switch (api[2]) {
        case "sendMessage": {
          const id = ++seq;
          messages.push({
            id,
            chat,
            from: "bot",
            text: String(payload.text ?? ""),
            buttons: buttonsOf(payload),
            edited: false,
            deleted: false,
          });
          return json(200, { ok: true, result: { message_id: id, chat: { id: Number(chat) } } });
        }
        case "editMessageText": {
          const found = messages.find(
            (m) =>
              m.chat === chat &&
              m.id === Number(payload.message_id) &&
              m.from === "bot" &&
              !m.deleted,
          );
          if (!found) return fail(400, "Bad Request: message to edit not found");
          const text = String(payload.text ?? "");
          const buttons = buttonsOf(payload);
          if (found.text === text && JSON.stringify(found.buttons) === JSON.stringify(buttons))
            return fail(400, "Bad Request: message is not modified");
          Object.assign(found, { text, buttons, edited: true });
          return json(200, { ok: true, result: { message_id: found.id } });
        }
        case "answerCallbackQuery": {
          const id = String(payload.callback_query_id ?? "");
          if (!id.startsWith("cb-")) return fail(400, "Bad Request: query id is invalid");
          return json(200, { ok: true, result: true });
        }
        case "deleteMessage": {
          const found = messages.find(
            (m) => m.chat === chat && m.id === Number(payload.message_id) && !m.deleted,
          );
          if (!found) return fail(400, "Bad Request: message to delete not found");
          found.deleted = true;
          return json(200, { ok: true, result: true });
        }
        default:
          return fail(404, "Not Found: method not found");
      }
    }

    return json(404, { ok: false, description: "rota desconhecida no Telegram de mentira" });
  })().catch(() => {
    response.writeHead(500);
    response.end();
  });
});

server.listen(port, "127.0.0.1", () =>
  process.stdout.write(`Telegram de mentira em http://127.0.0.1:${port}\n`),
);
