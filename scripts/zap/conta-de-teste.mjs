#!/usr/bin/env node
// A conta de TESTE da varredura logada do ZAP (M12.1), criada pelo caminho de verdade, contra o
// app que vai ser varrido (no CI, a imagem de produção):
//
//   1. cadastro (POST /api/auth/sign-up/email): o e-mail precisa estar no ALLOWED_EMAILS do app;
//   2. o link de confirmação que chega no Mailpit (o login acontece pelo link, como no app);
//   3. o 2FA obrigatório: liga com a senha e confirma com o código do app autenticador (TOTP);
//   4. confere: a sessão tem 2FA e a página inicial abre sem mandar para /configurar-2fa.
//
// Grava no arquivo de saída (modo 600) só o cabeçalho Cookie da sessão, que o ZAP manda em cada
// pedido (ZAP_AUTH_HEADER_VALUE). A senha é sorteada aqui e nunca sai deste processo; nada de
// cookie, senha ou código vai para a tela. Só Node (20+), sem dependências: roda direto no runner.
//
//   node scripts/zap/conta-de-teste.mjs --url http://localhost:3000 \
//     --mailpit http://localhost:8025 --email zap@fintrack.test --saida /tmp/zap-cookie
import { createHmac, randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    url: { type: "string", default: "http://localhost:3000" },
    mailpit: { type: "string", default: "http://localhost:8025" },
    email: { type: "string", default: "zap@fintrack.test" },
    saida: { type: "string" },
  },
});
if (!values.saida) fail("informe --saida <arquivo> (onde gravar o cabeçalho Cookie)");
const base = new URL(values.url);
const email = values.email.trim().toLowerCase();
const password = randomBytes(24).toString("base64url");

function fail(message) {
  process.stderr.write(`conta-de-teste: ${message}\n`);
  process.exit(1);
}

// ── Os cookies da sessão, como um navegador guardaria ──────────────────────────────────
const jar = new Map();
function keepCookies(response) {
  for (const line of response.headers.getSetCookie()) {
    const [pair, ...attributes] = line.split(";");
    const at = pair.indexOf("=");
    const name = pair.slice(0, at).trim();
    const value = pair.slice(at + 1).trim();
    const expired = attributes.some((a) => /^\s*max-age=0\s*$/i.test(a)) || value === "";
    if (expired) jar.delete(name);
    else jar.set(name, value);
  }
}
const cookieHeader = () => [...jar].map(([name, value]) => `${name}=${value}`).join("; ");

/** Um pedido ao app, com os cookies e a origem (a proteção de CSRF do Better Auth). */
async function app(path, { method = "GET", body } = {}) {
  const response = await fetch(new URL(path, base), {
    method,
    redirect: "manual",
    headers: {
      origin: base.origin,
      ...(jar.size ? { cookie: cookieHeader() } : {}),
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  keepCookies(response);
  return response;
}

async function expectOk(step, response) {
  if (response.ok) return response;
  // O corpo do Better Auth tem só código e mensagem (nada da conta); ajuda a achar o passo
  const text = (await response.text()).slice(0, 300);
  fail(`${step}: HTTP ${response.status} ${text}`);
}

// ── O código do app autenticador (RFC 6238: SHA-1, 6 dígitos, 30 s) ─────────────────────
function base32(text) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const char of text.replace(/=+$/, "").toUpperCase()) {
    const index = alphabet.indexOf(char);
    if (index === -1) fail("segredo do 2FA fora do formato base32");
    bits += index.toString(2).padStart(5, "0");
  }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8)
    bytes.push(Number.parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}
function totp(secret, now = Date.now()) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(now / 30_000)));
  const digest = createHmac("sha1", base32(secret)).update(counter).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const code = (digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return String(code).padStart(6, "0");
}

// ── O link de confirmação no Mailpit ───────────────────────────────────────────────────
async function verificationLink() {
  const mailpit = new URL(values.mailpit);
  for (let attempt = 0; attempt < 30; attempt++) {
    const search = await fetch(
      new URL(`/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`, mailpit),
    );
    if (search.ok) {
      const { messages = [] } = await search.json();
      if (messages.length > 0) {
        const message = await (
          await fetch(new URL(`/api/v1/message/${messages[0].ID}`, mailpit))
        ).json();
        const link = /https?:\/\/\S+\/api\/auth\/verify-email\?[^\s"<>]+/.exec(message.Text ?? "");
        if (link) return new URL(link[0]);
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  fail(`o e-mail de confirmação não chegou ao Mailpit (${values.mailpit}) em 30 s`);
}

// 1. Cadastro. O app responde igual quando o e-mail não está na lista (anti-enumeração): quem
//    revela é o e-mail que não chega no passo 2.
await expectOk(
  "cadastro",
  await app("/api/auth/sign-up/email", {
    method: "POST",
    body: { name: "Varredura ZAP", email, password },
  }),
);

// 2. O link do e-mail abre a sessão. O link vem com o endereço público do app; o pedido vai
//    para o endereço desta varredura (o mesmo, no CI)
const link = await verificationLink();
const verify = await app(`${link.pathname}${link.search}`);
if (verify.status >= 400) fail(`link de confirmação: HTTP ${verify.status}`);
if (jar.size === 0) fail("o link de confirmação não abriu a sessão (nenhum cookie)");

// 3. O 2FA obrigatório: liga e confirma com o código
const enable = await expectOk(
  "ligar o 2FA",
  await app("/api/auth/two-factor/enable", { method: "POST", body: { password } }),
);
const { totpURI } = await enable.json();
const secret = new URL(totpURI).searchParams.get("secret");
if (!secret) fail("ligar o 2FA: a resposta não trouxe o segredo");
await expectOk(
  "confirmar o 2FA",
  await app("/api/auth/two-factor/verify-totp", { method: "POST", body: { code: totp(secret) } }),
);

// 4. Confere: sessão com 2FA e a página inicial aberta (sem desvio para /configurar-2fa)
const session = await (await expectOk("sessão", await app("/api/auth/get-session"))).json();
if (session?.user?.email !== email || session.user.twoFactorEnabled !== true)
  fail("a sessão não ficou com o 2FA ligado");
const home = await app("/");
if (home.status !== 200)
  fail(`a página inicial respondeu ${home.status} (esperava 200 com a sessão)`);

writeFileSync(values.saida, cookieHeader(), { mode: 0o600 });
process.stdout.write(`conta-de-teste: ${email} pronta (cadastro, e-mail, 2FA)\n`);
