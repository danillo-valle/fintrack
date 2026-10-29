// Serve o dist/site num endereço local, como o GitHub Pages faria (para os testes e para olhar
// antes de publicar): pnpm --filter @fintrack/flow-map site:serve, em http://127.0.0.1:4173/fintrack/
import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";
import { OUT_DIR } from "./paths";

const PORT = Number(process.env.SITE_PORT ?? 4173);
/** O GitHub Pages serve o site em /<repositório>/: os testes usam o mesmo prefixo. */
const BASE = "/fintrack/";
const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
};

createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  if (!url.pathname.startsWith(BASE)) {
    res.writeHead(302, { location: BASE }).end();
    return;
  }
  let rel = decodeURIComponent(url.pathname.slice(BASE.length));
  if (rel === "" || rel.endsWith("/")) rel += "index.html";
  const file = path.resolve(OUT_DIR, rel);
  if (!file.startsWith(OUT_DIR + path.sep) || !existsSync(file) || !statSync(file).isFile()) {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" }).end("não encontrado");
    return;
  }
  res.writeHead(200, { "content-type": TYPES[path.extname(file)] ?? "application/octet-stream" });
  createReadStream(file).pipe(res);
}).listen(PORT, "127.0.0.1", () => {
  console.warn(`site em http://127.0.0.1:${PORT}${BASE}`);
});
