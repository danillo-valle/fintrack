import AxeBuilder from "@axe-core/playwright";
import {
  expect,
  test as base,
  type APIRequestContext,
  type Browser,
  type Page,
} from "@playwright/test";
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

/**
 * Os testes estão rodando contra o build de produção (a imagem Docker do M05) em vez do
 * pnpm dev? Liga com PLAYWRIGHT_PRODUCTION=1 (passo do manual do M05). Nesse modo, o catálogo
 * /dev/ui não existe (responde 404 de propósito) e os testes dele são pulados.
 */
export const PRODUCTION_BUILD = process.env.PLAYWRIGHT_PRODUCTION === "1";

/**
 * O lar da Ana nos testes (M06), criado pelo auth.setup.ts com ids FIXOS: assim as páginas de
 * carteira entram na lista PAGES abaixo e ganham, de graça, os testes de acessibilidade (axe),
 * de foco e de proteção. Ana é dona do lar e da "Casa da Ana"; a parceira (Pat) é membro do
 * lar e editora da Casa. "Viagem antiga" fica arquivada: a lista de carteiras sempre tem um item
 * arquivado para o axe conferir o contraste (achado do M06). Os testes de permissão que mudam
 * papéis criam lares próprios.
 */
export const ANA_HOUSEHOLD = {
  id: "e2e00000-0000-4000-8000-00000000a000",
  personalWalletId: "e2e00000-0000-4000-8000-00000000a001",
  sharedWalletId: "e2e00000-0000-4000-8000-00000000a002",
  partnerWalletId: "e2e00000-0000-4000-8000-00000000a003",
  partner: { name: "Pat Parceira", email: "parceira-ana@fintrack.test" },
} as const;

/**
 * O dinheiro do lar da Ana (M07), também com ids FIXOS: contas, cartão, categorias, uma regra
 * e um lançamento. Assim as telas de lançamento entram em PAGES (axe, foco, proteção) já com
 * conteúdo. Os testes que conferem somas ao centavo criam lares próprios (a Ana é compartilhada
 * pelos testes que rodam ao mesmo tempo).
 */
export const ANA_FINANCE = {
  checkingId: "e2e00000-0000-4000-8000-00000000a010",
  cardAccountId: "e2e00000-0000-4000-8000-00000000a011",
  cardId: "e2e00000-0000-4000-8000-00000000a012",
  homeAccountId: "e2e00000-0000-4000-8000-00000000a013",
  mercadoId: "e2e00000-0000-4000-8000-00000000a020",
  restauranteId: "e2e00000-0000-4000-8000-00000000a021",
  moradiaId: "e2e00000-0000-4000-8000-00000000a022",
  salarioId: "e2e00000-0000-4000-8000-00000000a023",
  transactionId: "e2e00000-0000-4000-8000-00000000a030",
} as const;

/** Páginas do app (exigem sessão). Os testes de acessibilidade, de foco e de proteção passam por cada uma. */
export const PAGES = [
  "/",
  "/lancamentos",
  "/lancamentos/novo",
  `/lancamentos/${ANA_FINANCE.transactionId}`,
  "/lancamentos/transferencia",
  "/lancamentos/recorrencias",
  "/orcamento",
  "/carteiras",
  "/carteiras/nova",
  `/carteiras/${ANA_HOUSEHOLD.sharedWalletId}`,
  `/carteiras/${ANA_HOUSEHOLD.personalWalletId}`,
  // Convite com segredo no formato certo, mas que não existe: a tela explica e não quebra
  `/convite/${"A".repeat(43)}`,
  "/ajustes",
  "/ajustes/lar",
  "/ajustes/contas",
  "/ajustes/categorias",
  "/ajustes/seguranca",
  ...(PRODUCTION_BUILD ? [] : ["/dev/ui"]),
];

/** Abre o catálogo de componentes, ou pula o teste no build de produção (onde ele não existe). */
export async function openCatalog(page: Page) {
  base.skip(PRODUCTION_BUILD, "o catálogo /dev/ui só existe em desenvolvimento");
  return openPage(page, "/dev/ui");
}

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

// ── Lar e carteiras (M06) ─────────────────────────────────────────────────────

/** O id (texto do Better Auth) de uma conta pelo e-mail. */
export async function userIdByEmail(email: string): Promise<string> {
  const [row] = await sql<{ id: string }>('SELECT id FROM "user" WHERE email = $1', [email]);
  if (!row) throw new Error(`conta ${email} não existe`);
  return row.id;
}

type Role = "OWNER" | "EDITOR" | "VIEWER";

/**
 * Cria um lar direto no banco, sem passar pelas telas: para os testes que começam com o lar
 * pronto. (O fluxo pelas telas, com convite, tem o próprio teste em permissoes.spec.ts.)
 * Ids opcionais: o lar da Ana usa ids fixos; os outros testes deixam o banco sortear.
 * Devolve os ids das carteiras: personal[email] e shared[nome].
 */
export async function createHouseholdDirect(input: {
  id?: string;
  name: string;
  people: { email: string; role: "OWNER" | "MEMBER"; personalWalletId?: string }[];
  shared?: {
    id?: string;
    name: string;
    members: { email: string; role: Role }[];
    archived?: boolean;
  }[];
}) {
  if (input.id) await sql("DELETE FROM household WHERE id = $1", [input.id]);
  const ids = new Map<string, string>();
  for (const p of input.people) ids.set(p.email, await userIdByEmail(p.email));

  const [household] = await sql<{ id: string }>(
    `INSERT INTO household (id, name, "updatedAt") VALUES (COALESCE($1::uuid, gen_random_uuid()), $2, now())
     RETURNING id`,
    [input.id ?? null, input.name],
  );
  const householdId = household!.id;

  const personal: Record<string, string> = {};
  for (const p of input.people) {
    const userId = ids.get(p.email)!;
    await sql(`INSERT INTO household_member ("householdId", "userId", role) VALUES ($1, $2, $3)`, [
      householdId,
      userId,
      p.role,
    ]);
    personal[p.email] = await insertWallet(
      householdId,
      p.personalWalletId,
      p.email.split("@")[0]!,
      "PERSONAL",
      userId,
      [{ userId, role: "OWNER" }],
    );
  }
  const shared: Record<string, string> = {};
  for (const w of input.shared ?? []) {
    const members = w.members.map((m) => ({ userId: ids.get(m.email)!, role: m.role }));
    shared[w.name] = await insertWallet(
      householdId,
      w.id,
      w.name,
      "SHARED",
      members[0]!.userId,
      members,
    );
  }
  return { householdId, personal, shared };
}

async function insertWallet(
  householdId: string,
  id: string | undefined,
  name: string,
  kind: "PERSONAL" | "SHARED",
  createdById: string,
  members: { userId: string; role: Role }[],
) {
  const [wallet] = await sql<{ id: string }>(
    `INSERT INTO wallet (id, "householdId", name, kind, "createdById", "updatedAt")
     VALUES (COALESCE($1::uuid, gen_random_uuid()), $2, $3, $4, $5, now()) RETURNING id`,
    [id ?? null, householdId, name, kind, createdById],
  );
  for (const m of members) {
    await sql(
      `INSERT INTO wallet_member ("householdId", "walletId", "userId", role) VALUES ($1, $2, $3, $4)`,
      [householdId, wallet!.id, m.userId, m.role],
    );
  }
  return wallet!.id;
}

/** Apaga lares de teste (carteiras, membros e convites vão junto, em cascata). */
export async function deleteHouseholds(ids: string[]) {
  await sql("DELETE FROM household WHERE id = ANY($1::uuid[])", [ids]);
}

/** Regras da WCAG até a 2.2, níveis A e AA (as mesmas do acessibilidade.spec.ts). */
export async function expectNoA11yViolations(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(
    results.violations.map((v) => ({ regra: v.id, onde: v.nodes.map((n) => n.target) })),
  ).toEqual([]);
}

// ── Lançamentos, contas e categorias (M07) ───────────────────────────────────

/** Data de hoje em São Paulo (AAAA-MM-DD), como o app calcula. */
export function todaySaoPaulo(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
}

type AccountKind = "CHECKING" | "SAVINGS" | "CREDIT_CARD" | "MEAL_VOUCHER" | "CASH";

/**
 * Contas, cartões, categorias, regras e lançamentos direto no banco, para um lar já criado
 * (createHouseholdDirect). Ids opcionais: o lar da Ana usa ids fixos. Devolve os ids pelo nome.
 */
export async function createFinanceDirect(input: {
  householdId: string;
  accounts?: {
    id?: string;
    walletId: string;
    name: string;
    kind: AccountKind;
    holderEmail?: string;
    closingDay?: number;
    dueDay?: number;
    cards?: {
      id?: string;
      nickname: string;
      lastFour: string;
      holderEmail: string;
      isAdditional?: boolean;
    }[];
  }[];
  categories?: { id?: string; name: string; kind: "EXPENSE" | "INCOME" }[];
  rules?: { pattern: string; category: string }[];
  transactions?: {
    id?: string;
    walletId: string;
    account: string;
    amount: string;
    occurredOn: string;
    description: string;
    category?: string;
    transferId?: string;
  }[];
}) {
  const accounts: Record<string, { id: string; kind: AccountKind }> = {};
  for (const a of input.accounts ?? []) {
    const holderId = a.holderEmail ? await userIdByEmail(a.holderEmail) : null;
    const [row] = await sql<{ id: string }>(
      `INSERT INTO financial_account (id, "householdId", "walletId", "holderId", name, kind, "closingDay", "dueDay", "updatedAt")
       VALUES (COALESCE($1::uuid, gen_random_uuid()), $2, $3, $4, $5, $6, $7, $8, now()) RETURNING id`,
      [
        a.id ?? null,
        input.householdId,
        a.walletId,
        holderId,
        a.name,
        a.kind,
        a.closingDay ?? null,
        a.dueDay ?? null,
      ],
    );
    accounts[a.name] = { id: row!.id, kind: a.kind };
    for (const c of a.cards ?? []) {
      await sql(
        `INSERT INTO payment_card (id, "accountId", "holderId", nickname, brand, "lastFour", form, "isAdditional", "updatedAt")
         VALUES (COALESCE($1::uuid, gen_random_uuid()), $2, $3, $4, 'Mastercard', $5, 'PHYSICAL', $6, now())`,
        [
          c.id ?? null,
          row!.id,
          await userIdByEmail(c.holderEmail),
          c.nickname,
          c.lastFour,
          c.isAdditional ?? false,
        ],
      );
    }
  }
  const categories: Record<string, string> = {};
  for (const c of input.categories ?? []) {
    const [row] = await sql<{ id: string }>(
      `INSERT INTO category (id, "householdId", name, kind, "updatedAt")
       VALUES (COALESCE($1::uuid, gen_random_uuid()), $2, $3, $4, now()) RETURNING id`,
      [c.id ?? null, input.householdId, c.name, c.kind],
    );
    categories[c.name] = row!.id;
  }
  for (const r of input.rules ?? []) {
    await sql(
      `INSERT INTO category_rule (id, "householdId", "categoryId", pattern) VALUES (gen_random_uuid(), $1, $2, $3)`,
      [input.householdId, categories[r.category], r.pattern],
    );
  }
  for (const t of input.transactions ?? []) {
    const account = accounts[t.account]!;
    const method = t.transferId ? "TRANSFER" : account.kind === "CREDIT_CARD" ? "CREDIT" : "PIX";
    await sql(
      `INSERT INTO "transaction" (id, "householdId", "walletId", "accountId", method, "categoryId", amount, "occurredOn", description, "transferId", "updatedAt")
       VALUES (COALESCE($1::uuid, gen_random_uuid()), $2, $3, $4, $5, $6, $7, $8, $9, $10, now())`,
      [
        t.id ?? null,
        input.householdId,
        t.walletId,
        account.id,
        method,
        t.category ? categories[t.category] : null,
        t.amount,
        t.occurredOn,
        t.description,
        t.transferId ?? null,
      ],
    );
  }
  return { accounts, categories };
}

/**
 * Uma pessoa nova, com 2FA, já logada num contexto próprio do navegador (cookies separados,
 * como outro celular), com o aparelho do teste (desktop ou celular).
 */
export async function personInNewTab(
  browser: Browser,
  email: string,
  name: string,
  options: {
    password?: string;
    viewport?: { width: number; height: number } | null;
    isMobile?: boolean;
  } = {},
) {
  const context = await browser.newContext({
    locale: "pt-BR",
    timezoneId: "America/Sao_Paulo",
    ...(options.viewport ? { viewport: options.viewport } : {}),
    ...(options.isMobile ? { isMobile: true, hasTouch: true } : {}),
  });
  await context.setExtraHTTPHeaders({ "X-Forwarded-For": fakeIp() });
  const page = await context.newPage();
  const created = await createTestUser(page.request, {
    email,
    password: options.password ?? "frase longa para testar lancamentos",
    name,
    twoFactor: true,
  });
  return { page, context, secret: created.secret, close: () => context.close() };
}
