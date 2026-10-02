import { expect, test as base, type APIRequestContext, type Page } from "@playwright/test";
import { hashPassword } from "better-auth/crypto";
import { generateSync } from "otplib";
import pg from "pg";

/** Abre a página e espera o React terminar de carregar, para nada do que for digitado se perder. */
export async function openPage(page: Page, path: string) {
  const response = await page.goto(path);
  await expect(page.locator("html[data-hydrated]")).toBeAttached();
  return response;
}

/**
 * O aviso do formulário (erro ou sucesso). Filtra pelo data-slot porque o Next.js também tem
 * um elemento com role="alert": o anunciador de mudança de página para leitores de tela.
 */
export function formAlert(page: Page) {
  return page.locator('[data-slot="form-alert"]');
}

/** O Intl separa "R$" do número com um espaço não separável (U+00A0). */
export const brl = (text: string) => text.replace(" ", " ");

/** Páginas do app (exigem sessão). Os testes de acessibilidade, de foco e de proteção passam por cada uma. */
export const PAGES = [
  "/",
  "/lancamentos",
  "/lancamentos/novo",
  "/orcamento",
  "/carteiras",
  "/ajustes",
  "/ajustes/seguranca",
  "/dev/ui",
];

/**
 * Telas de entrada (abertas, sem sessão). Também passam pelos testes de acessibilidade e foco.
 * /entrar/dois-fatores não está aqui: sem a senha digitada antes, ela volta para /entrar.
 * Os testes chegam nela pelo caminho real, com startTwoFactor().
 */
export const PUBLIC_PAGES = [
  "/entrar",
  "/cadastro",
  "/verifique-seu-email",
  "/esqueci-a-senha",
  "/redefinir-senha",
];

/** Sem cookies: para os testes que começam deslogados. */
export const NO_SESSION = { cookies: [], origins: [] };

/** A conta que os testes usam já logada (criada pelo auth.setup.ts). */
export const TEST_USER = {
  name: "Ana Teste",
  email: "ana@fintrack.test",
  password: "cafe com pao de queijo na varanda",
};
export const AUTH_FILE = "e2e/.auth/ana.json";
export const TOTP_FILE = "e2e/.auth/ana-totp.txt";

export const BASE_URL = "http://localhost:3000";
const MAILPIT_URL = process.env.MAILPIT_URL ?? "http://localhost:8025";

// ── Código do app autenticador ────────────────────────────────────────────────

/** Gera o código de 6 dígitos de agora, como o app do celular faria (otplib). */
export function totp(secret: string): string {
  return generateSync({ secret });
}

/** Tira o segredo do endereço otpauth:// devolvido pelo Better Auth ao ligar o 2FA. */
export function secretFromUri(totpURI: string): string {
  const secret = new URL(totpURI).searchParams.get("secret");
  if (!secret) throw new Error(`URI sem segredo: ${totpURI}`);
  return secret;
}

// ── Banco de dados ────────────────────────────────────────────────────────────

/** Roda um comando SQL no banco de desenvolvimento (o mesmo do app). */
export async function sql<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  values: unknown[] = [],
): Promise<T[]> {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    return (await client.query<T>(text, values)).rows;
  } finally {
    await client.end();
  }
}

/** Apaga a conta e tudo que é dela (sessões, 2FA, passkeys: ON DELETE CASCADE). */
export async function deleteUser(email: string) {
  await sql('DELETE FROM "user" WHERE email = $1', [email]);
}

/** Faz as sessões da conta parecerem antigas (para testar a reautenticação). */
export async function ageSessions(email: string, minutes: number) {
  await sql(
    `UPDATE session SET "createdAt" = now() - make_interval(mins => $2), "reauthenticatedAt" = NULL
     WHERE "userId" = (SELECT id FROM "user" WHERE email = $1)`,
    [email, minutes],
  );
}

// ── Mailpit (o "servidor de e-mail" de desenvolvimento) ──────────────────────

type MailpitMessage = { ID: string; Subject: string; To: { Address: string }[] };

/** Espera chegar um e-mail para o endereço e devolve o primeiro link http do texto. */
export async function linkFromEmail(to: string, subject: RegExp): Promise<string> {
  let link: string | undefined;
  await expect
    .poll(
      async () => {
        const search = await fetch(
          `${MAILPIT_URL}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}`,
        );
        const { messages } = (await search.json()) as { messages: MailpitMessage[] };
        const message = messages.find((m) => subject.test(m.Subject));
        if (!message) return null;
        const full = await fetch(`${MAILPIT_URL}/api/v1/message/${message.ID}`);
        const { Text } = (await full.json()) as { Text: string };
        link = /https?:\/\/\S+/.exec(Text)?.[0];
        return link ?? null;
      },
      { message: `e-mail "${subject}" para ${to}`, timeout: 15_000 },
    )
    .not.toBeNull();
  return link as string;
}

/** Quantos e-mails chegaram para o endereço. */
export async function countEmails(to: string): Promise<number> {
  const search = await fetch(
    `${MAILPIT_URL}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}`,
  );
  const { messages } = (await search.json()) as { messages: MailpitMessage[] };
  return messages.length;
}

/** Apaga os e-mails de um endereço, para o teste não ler um link velho. */
export async function clearEmails(to: string) {
  await fetch(`${MAILPIT_URL}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}`, {
    method: "DELETE",
  });
}

// ── Contas de teste ───────────────────────────────────────────────────────────

/** Cabeçalhos das chamadas diretas à API: o Better Auth confere a origem (proteção CSRF). */
export function apiHeaders(ip: string) {
  return { Origin: BASE_URL, "X-Forwarded-For": ip };
}

/** Um IP falso diferente por teste: o limite de tentativas conta por IP, e os testes rodam juntos. */
export function fakeIp(): string {
  const n = () => Math.floor(Math.random() * 254) + 1;
  return `10.${n()}.${n()}.${n()}`;
}

/**
 * Cria uma conta de teste pronta: e-mail confirmado e, se pedido, 2FA ligado.
 * Usa o banco direto para pular o cadastro (que só aceita e-mails da lista) e a API para o 2FA,
 * pelo mesmo caminho que a tela usa. Devolve o segredo do app autenticador.
 */
export async function createTestUser(
  request: APIRequestContext,
  options: { email: string; password: string; name?: string; twoFactor?: boolean },
): Promise<{ secret: string | null; backupCodes: string[] }> {
  const { email, password, name = "Pessoa de Teste", twoFactor = true } = options;
  await deleteUser(email);
  const id = crypto.randomUUID();
  await sql(
    `INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
     VALUES ($1, $2, $3, true, now(), now())`,
    [id, name, email],
  );
  await sql(
    `INSERT INTO account (id, "accountId", "providerId", "userId", password, "createdAt", "updatedAt")
     VALUES ($1, $2, 'credential', $2, $3, now(), now())`,
    [crypto.randomUUID(), id, await hashPassword(password)],
  );
  if (!twoFactor) return { secret: null, backupCodes: [] };

  const headers = apiHeaders(fakeIp());
  const signIn = await request.post("/api/auth/sign-in/email", {
    headers,
    data: { email, password },
  });
  expect(signIn.ok(), await signIn.text()).toBe(true);
  const enable = await request.post("/api/auth/two-factor/enable", { headers, data: { password } });
  expect(enable.ok(), await enable.text()).toBe(true);
  const enabled = (await enable.json()) as { totpURI: string; backupCodes: string[] };
  const secret = secretFromUri(enabled.totpURI);
  const verify = await request.post("/api/auth/two-factor/verify-totp", {
    headers,
    data: { code: totp(secret) },
  });
  expect(verify.ok(), await verify.text()).toBe(true);
  return { secret, backupCodes: enabled.backupCodes };
}

/**
 * Entra pela tela, como uma pessoa: e-mail, senha e o código do app.
 * Cada teste usa um IP falso próprio, para o limite de tentativas não misturar testes.
 */
export async function signInThroughUi(page: Page, email: string, password: string, secret: string) {
  await page.context().setExtraHTTPHeaders({ "X-Forwarded-For": fakeIp() });
  await openPage(page, "/entrar");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await expect(page).toHaveURL(/\/entrar\/dois-fatores/);
  await expect(page.locator("html[data-hydrated]")).toBeAttached();
  await page.getByLabel("Código do app autenticador").fill(totp(secret));
  await page.getByRole("button", { name: "Confirmar" }).click();
}

/** Digita e-mail e senha em /entrar e para na tela do código (/entrar/dois-fatores). */
export async function startTwoFactor(page: Page, email: string, password: string) {
  await page.context().setExtraHTTPHeaders({ "X-Forwarded-For": fakeIp() });
  await openPage(page, "/entrar");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await expect(page).toHaveURL(/\/entrar\/dois-fatores/);
  await expect(page.locator("html[data-hydrated]")).toBeAttached();
}

/** E-mail de teste único por arquivo, teste e aparelho (desktop e celular rodam ao mesmo tempo). */
export function testEmail(slug: string, project: string): string {
  return `e2e-${slug}-${project}@fintrack.test`;
}

/** Teste com um IP falso próprio já aplicado no navegador. */
// O segundo parâmetro se chama "provide" (a documentação do Playwright usa "use"): com "use",
// a regra de hooks do React no ESLint confunde com um hook e reprova o arquivo.
export const test = base.extend({
  context: async ({ context }, provide) => {
    await context.setExtraHTTPHeaders({ "X-Forwarded-For": fakeIp() });
    await provide(context);
  },
});
