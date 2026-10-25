/**
 * O app do build de produção para os testes de ponta a ponta (M12.2, ADR-021), sem Docker.
 *
 * Monta o servidor "standalone" do mesmo jeito que o Dockerfile monta a imagem: o servidor que o
 * `next build` gera em .next/standalone, mais os arquivos estáticos (.next/static) e a pasta
 * public, que o Next.js deixa de fora de propósito. Depois sobe o server.js na porta 3000.
 *
 * Quem chama: o playwright.config.ts, quando PLAYWRIGHT_PRODUCTION=1 (o CI e o "pnpm
 * e2e:producao"). Antes, o build: `pnpm --filter @fintrack/web build`.
 */
import { spawn } from "node:child_process";
import { cpSync, existsSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import path from "node:path";

const APP = path.resolve(import.meta.dirname, "..");

// As variáveis do app: o .env da raiz em casa (como o playwright.config.ts); no CI, o workflow
try {
  process.loadEnvFile(path.resolve(APP, "../../.env"));
} catch {
  // sem .env (CI): segue com as variáveis do ambiente
}
const STANDALONE_APP = path.join(APP, ".next/standalone/apps/web");
const SERVER = path.join(STANDALONE_APP, "server.js");

if (!existsSync(SERVER)) {
  console.error(
    "Não achei o build de produção (.next/standalone). Rode antes: pnpm --filter @fintrack/web build",
  );
  process.exit(1);
}

// Um build velho testaria o código de ontem sem ninguém perceber: avisa quando o build é mais
// antigo que a última mudança em src/ (o teste continua, porque o aviso pode ser um alarme falso
// de um arquivo só tocado; quem decide é quem lê).
const builtAt = statSync(path.join(APP, ".next/BUILD_ID")).mtimeMs;
const newest = newestMtime(path.join(APP, "src"));
if (newest > builtAt) {
  console.warn(
    "AVISO: há arquivos em apps/web/src mais novos que o build de produção. Para testar o código " +
      "de agora, rode de novo: pnpm --filter @fintrack/web build",
  );
}

// O mesmo que o Dockerfile faz com COPY: os estáticos e a pasta public ao lado do server.js
for (const [from, to] of [
  [path.join(APP, ".next/static"), path.join(STANDALONE_APP, ".next/static")],
  [path.join(APP, "public"), path.join(STANDALONE_APP, "public")],
] as const) {
  rmSync(to, { recursive: true, force: true });
  if (existsSync(from)) cpSync(from, to, { recursive: true });
}

const buildId = readFileSync(path.join(APP, ".next/BUILD_ID"), "utf8").trim();
process.stdout.write(`Build de produção ${buildId} na porta ${process.env.PORT ?? "3000"}\n`);

const server = spawn(process.execPath, [SERVER], {
  cwd: STANDALONE_APP,
  stdio: "inherit",
  env: {
    ...process.env,
    NODE_ENV: "production",
    HOSTNAME: "127.0.0.1",
    PORT: process.env.PORT ?? "3000",
  },
});
// O Playwright encerra este processo no fim: o servidor vai junto
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => server.kill(signal));
}
server.on("exit", (code) => process.exit(code ?? 0));

function newestMtime(dir: string): number {
  let newestSeen = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true, recursive: true })) {
    if (entry.isFile()) {
      newestSeen = Math.max(newestSeen, statSync(path.join(entry.parentPath, entry.name)).mtimeMs);
    }
  }
  return newestSeen;
}
