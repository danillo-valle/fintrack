// Uma Pluggy de mentira, que responde como a API de verdade a partir do banco sintético.
// Usada nos testes do adaptador, nos testes de integração da sincronização e, como servidor
// HTTP (servePluggyFake), nos testes E2E. Nenhum teste chama a Pluggy de verdade (nem no CI).
import { createServer, type Server } from "node:http";
import type { FetchLike } from "../pluggy/client";
import { SYNTHETIC_CREDENTIALS, toPluggyJson, type SyntheticBank } from "./synthetic";

export type FakePluggyOptions = {
  credentials?: { clientId: string; clientSecret: string };
  /** Itens por página em /v2/transactions (pequeno de propósito, para exercitar o cursor) */
  pageSize?: number;
  /** Força uma falha em rotas que começam com este caminho ("/accounts": 503) */
  failures?: Record<string, number>;
};

export type FakePluggy = {
  fetch: FetchLike;
  /** Chamadas recebidas ("GET /accounts"), para os testes conferirem o que foi pedido */
  calls: string[];
  /** Troca o banco (simula o banco mudando um lançamento entre duas buscas) */
  setBank(bank: SyntheticBank): void;
};

const json = (status: number, body: unknown) => ({
  status,
  text: async () => toPluggyJson(body),
});

export function createFakePluggy(
  initial: SyntheticBank,
  options: FakePluggyOptions = {},
): FakePluggy {
  let bank = initial;
  const creds = options.credentials ?? SYNTHETIC_CREDENTIALS;
  const pageSize = options.pageSize ?? 5;
  const issued = new Set<string>();
  const calls: string[] = [];
  let keySeq = 0;

  const fetch: FetchLike = async (url, init) => {
    const parsed = new URL(url);
    const route = `${init.method} ${parsed.pathname}`;
    calls.push(route);
    for (const [prefix, status] of Object.entries(options.failures ?? {})) {
      if (parsed.pathname.startsWith(prefix)) return json(status, { message: "falha simulada" });
    }

    // Para o Playwright saber que o servidor subiu
    if (route === "GET /health") return json(200, { ok: true });

    if (route === "POST /auth") {
      const body = JSON.parse(init.body ?? "{}") as { clientId?: string; clientSecret?: string };
      if (body.clientId !== creds.clientId || body.clientSecret !== creds.clientSecret) {
        return json(401, { message: "Invalid credentials" });
      }
      keySeq += 1;
      const apiKey = `chave-sintetica-${keySeq}-${"x".repeat(16)}`;
      issued.add(apiKey);
      return json(200, { apiKey });
    }

    if (!issued.has(init.headers["x-api-key"] ?? "")) return json(401, { message: "Unauthorized" });

    const itemMatch = /^\/items\/([^/]+)$/.exec(parsed.pathname);
    if (init.method === "GET" && itemMatch) {
      const item = bank.items[decodeURIComponent(itemMatch[1] ?? "")];
      return item ? json(200, item) : json(404, { message: "Item not found" });
    }

    if (route === "GET /accounts") {
      const itemId = parsed.searchParams.get("itemId");
      if (!itemId || !bank.items[itemId]) return json(404, { message: "Item not found" });
      const results = bank.accounts.filter((a) => a.itemId === itemId);
      return json(200, { total: results.length, totalPages: 1, page: 1, results });
    }

    if (route === "GET /v2/transactions") {
      const accountId = parsed.searchParams.get("accountId");
      const from = parsed.searchParams.get("dateFrom") ?? "0000-00-00";
      const to = parsed.searchParams.get("dateTo") ?? "9999-99-99";
      const after = Number.parseInt(parsed.searchParams.get("after") ?? "0", 10);
      const all = bank.transactions.filter((t) => {
        const date = String(t.date).slice(0, 10);
        return t.accountId === accountId && date >= from && date <= to;
      });
      const results = all.slice(after, after + pageSize);
      const nextIndex = after + pageSize;
      const next =
        nextIndex < all.length
          ? `?accountId=${accountId}&dateFrom=${from}&dateTo=${to}&after=${nextIndex}`
          : null;
      return json(200, { results, next });
    }

    if (route === "GET /bills") {
      const accountId = parsed.searchParams.get("accountId");
      const results = bank.bills.filter((b) => b.accountId === accountId);
      return json(200, { total: results.length, totalPages: 1, page: 1, results });
    }

    return json(404, { message: "Not found" });
  };

  return {
    fetch,
    calls,
    setBank(next) {
      bank = next;
    },
  };
}

/**
 * Sobe a Pluggy de mentira como servidor HTTP (testes E2E): o app aponta PLUGGY_API_URL para cá.
 * Só escuta em 127.0.0.1.
 */
export async function servePluggyFake(fake: FakePluggy, port: number): Promise<Server> {
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const headers: Record<string, string> = {};
      for (const [key, value] of Object.entries(req.headers)) {
        if (typeof value === "string") headers[key.toLowerCase()] = value;
      }
      void fake
        .fetch(`http://127.0.0.1:${port}${req.url ?? "/"}`, {
          method: req.method ?? "GET",
          headers,
          body: chunks.length ? Buffer.concat(chunks).toString("utf8") : undefined,
        })
        .then(async (response) => {
          res.writeHead(response.status, { "content-type": "application/json" });
          res.end(await response.text());
        });
    });
  });
  await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve));
  return server;
}
