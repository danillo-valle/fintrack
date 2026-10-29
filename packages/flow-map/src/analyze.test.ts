import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { analyze } from "./analyze";
import type { FlowMap, Screen } from "./model";
import { serialize } from "./serialize";
import { makeRepo } from "./testing/fixture";

const W = "apps/web/src";

// Um app de mentira com o que o mapa precisa reconhecer: telas, modal, tela pública, moldura,
// componentes do navegador, actions com schema, carregamentos, banco, regras, filas e serviços.
const FILES: Record<string, string> = {
  "packages/db/prisma/schema/schema.prisma": `
model Wallet {
  id String @id
  @@map("wallet")
}

model AuditLog {
  id String @id
  @@map("audit_log")
}

model FinancialAccount {
  id String @id
  @@map("financial_account")
}
`,
  "packages/db/src/index.ts": `
export const prisma = {} as never;
export * from "./wallets";
export { writeAudit as audit } from "./audit";
`,
  "packages/db/src/wallets.ts": `
import { prisma } from "./index";
import { audit } from "./audit-helper";
export async function createWallet(name: string) {
  await audit(name);
  return prisma.wallet.create({ data: { name } });
}
export async function listWallets() {
  return prisma.$queryRaw\`SELECT * FROM wallet JOIN "financial_account" ON true\`;
}
export class DomainError extends Error {}
`,
  "packages/db/src/audit-helper.ts": `
import { prisma } from "./index";
export async function audit(what: string) {
  return prisma.auditLog.create({ data: { what } });
}
`,
  "packages/db/src/audit.ts": `export function writeAudit() { return 1; }`,
  "packages/core/src/index.ts": `export function toCents(v: string) { return v; } export const LIMIT = 3;`,
  [`${W}/lib/env.ts`]: `
import { z } from "zod";
const envSchema = z.object({ SECRET: z.string() });
export const env = envSchema.parse(process.env);
`,
  [`${W}/lib/logger.ts`]: `export const logger = { info() {} };`,
  [`${W}/lib/auth/session.ts`]: `export async function requireUser() { return { user: { id: "1" } }; }`,
  [`${W}/lib/auth-client.ts`]: `export const authClient = {} as never;`,
  [`${W}/lib/mailer.ts`]: `
import { env } from "./env";
export async function sendMail(to: string) { return fetch(env.SECRET + to); }
export const MAIL_FROM = "x";
`,
  [`${W}/lib/auth.ts`]: `
import { sendMail } from "./mailer";
export const auth = { handler: () => sendMail("a") };
`,
  [`${W}/lib/jobs.ts`]: `
export const QUEUES = { walletSync: { name: "wallet-sync" }, daily: { name: "wallet-daily" } } as const;
export async function jobs() { return {} as never; }
`,
  [`${W}/lib/finance-cache.ts`]: `export function financeChanged() {}`,
  [`${W}/lib/access.ts`]: `export async function requireWalletAccess(_s: unknown, _w: unknown, _p: string) {}`,
  [`${W}/features/wallets/schemas.ts`]: `
import { z } from "zod";
const baseSchema = z.object({ name: z.string() });
export const walletSchema = baseSchema.extend({ kind: z.string(), "color-hex": z.string() });
`,
  [`${W}/features/wallets/server/actions.ts`]: `"use server";
import { createWallet, prisma, DomainError } from "@fintrack/db";
import { toCents, LIMIT } from "@fintrack/core";
import { redirect } from "next/navigation";
import { requireWalletAccess } from "@/lib/access";
import { financeChanged } from "@/lib/finance-cache";
import { logger } from "@/lib/logger";
import { walletSchema } from "../schemas";
import { enqueueSync } from "./jobs";
import { checkLimit } from "./limits";

const PAGE = "/carteiras";

export async function createWalletAction(_prev: unknown, formData: FormData) {
  const parsed = walletSchema.safeParse(Object.fromEntries(formData));
  const note = formData.get("nota");
  await requireWalletAccess(null, null, "manage_wallet");
  logger.info();
  toCents(String(note));
  void LIMIT;
  void DomainError;
  checkLimit();
  await createWallet(String(parsed));
  financeChanged();
  redirect(\`\${PAGE}/\${String(parsed)}?criada=1\`);
}

export async function syncWalletAction() {
  await prisma.wallet.count();
  await enqueueSync();
}
`,
  [`${W}/features/wallets/server/limits.ts`]: `
import { z } from "zod";
const limitSchema = z.object({ teto: z.number() });
export function checkLimit() { return limitSchema.parse({ teto: 1 }); }
`,
  [`${W}/features/wallets/server/jobs.ts`]: `
import { jobs, QUEUES } from "@/lib/jobs";
import { sendMail } from "@/lib/mailer";
import { listWallets } from "@fintrack/db";
const SYNC_QUEUE = QUEUES.walletSync.name;
const DAILY_QUEUE = QUEUES.daily.name;
const DAILY_CRON = "30 4 * * *";
export async function enqueueSync() {
  const boss = await jobs();
  await boss.send(SYNC_QUEUE, {});
}
export async function startWorkers() {
  const boss = await jobs();
  await boss.work(SYNC_QUEUE, async () => { await listWallets(); await sendMail("x"); });
  await boss.work(DAILY_QUEUE, async () => { await boss.send(SYNC_QUEUE, {}); });
  await boss.schedule(DAILY_QUEUE, DAILY_CRON, null, {});
}
`,
  [`${W}/features/wallets/server/queries.ts`]: `
import { listWallets } from "@fintrack/db";
export const PAGE_SIZE = 10;
export async function getWalletsPage(_s: unknown, _search: unknown) { return listWallets(); }
`,
  [`${W}/features/wallets/ui/forms.tsx`]: `"use client";
import { createWalletAction, syncWalletAction } from "../server/actions";
import { Button } from "@/components/ui/button";
export function NewWalletForm() {
  return <form action={createWalletAction}><Button /></form>;
}
export function SyncButton() {
  return <form action={syncWalletAction} />;
}
`,
  [`${W}/components/ui/button.tsx`]: `"use client";
import { secretThing } from "./not-followed";
export function Button() { return <button>{secretThing}</button>; }
`,
  [`${W}/components/layout/page-header.tsx`]: `
import Link from "next/link";
export function PageHeader({ title }: { title: string; help: string | null }) {
  return <header><Link href="/ajuda?q=1#topo">{title}</Link></header>;
}
`,
  [`${W}/app/(app)/carteiras/nova/page.tsx`]: `
import type { Metadata } from "next";
import { PageHeader } from "@/components/layout/page-header";
import { requireUser } from "@/lib/auth/session";
import { getWalletsPage, PAGE_SIZE } from "@/features/wallets/server/queries";
import { NewWalletForm } from "@/features/wallets/ui/forms";

export const metadata: Metadata = { title: "Nova carteira" };

export default async function NewWalletPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const session = await requireUser();
  const params = await searchParams;
  const { volta } = await searchParams;
  await getWalletsPage(session, await searchParams);
  void PAGE_SIZE;
  return (
    <>
      <PageHeader help="carteiras" title="Nova carteira" />
      <NewWalletForm />
      <a href={\`/carteiras/\${params.id}\`}>{volta}{params.mes}</a>
    </>
  );
}
`,
  [`${W}/app/(app)/@modal/(.)carteiras/nova/page.tsx`]: `
import { NewWalletForm } from "@/features/wallets/ui/forms";
export default function NewWalletModal() { return <NewWalletForm />; }
`,
  [`${W}/app/(app)/carteiras/[walletId]/page.tsx`]: `
import { SyncButton } from "@/features/wallets/ui/forms";
export default async function WalletPage() { return <SyncButton />; }
`,
  [`${W}/app/(app)/layout.tsx`]: `
import Link from "next/link";
const LINKS = [{ href: "/carteiras", label: "Carteiras" }];
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <nav>{LINKS.map((l) => <Link key={l.href} href={l.href}>{l.label}</Link>)}{children}</nav>;
}
`,
  [`${W}/features/auth/ui/sign-in.tsx`]: `"use client";
import { authClient } from "@/lib/auth-client";
export function SignIn() {
  return <button onClick={() => authClient.signIn.email({})}>Entrar</button>;
}
`,
  [`${W}/app/(auth)/entrar/page.tsx`]: `
import { SignIn } from "@/features/auth/ui/sign-in";
export default function SignInPage() { return <><SignIn /><a href="/cadastro">Criar</a></>; }
`,
  [`${W}/app/api/auth/[...all]/route.ts`]: `
import { auth } from "@/lib/auth";
export const { GET, POST } = { GET: auth.handler, POST: auth.handler };
`,
  [`${W}/app/api/health/route.ts`]: `
import { requireUser } from "@/lib/auth/session";
import { auth } from "@/lib/auth";
export async function GET() { void auth; return requireUser(); }
`,
};

let map: FlowMap;
let root: string;
let cleanup: () => void;

beforeAll(() => {
  ({ root, cleanup } = makeRepo(FILES));
  map = analyze(root);
});
afterAll(() => cleanup());

const screen = (route: string, kind: Screen["kind"]) => {
  const found = map.screens.find((s) => s.route === route && s.kind === kind);
  if (!found) throw new Error(`tela ${route} (${kind}) não está no mapa`);
  return found;
};
const action = (name: string) => {
  const found = map.actions.find((a) => a.name === name);
  if (!found) throw new Error(`action ${name} não está no mapa`);
  return found;
};

describe("as telas", () => {
  it("dá o endereço de cada tela: o grupo some, o @modal/(.) intercepta, (auth) é pública", () => {
    expect(map.screens.map((s) => [s.route, s.kind, s.area])).toEqual([
      ["/", "layout", "Moldura"],
      ["/carteiras/[walletId]", "page", "Carteiras"],
      ["/carteiras/nova", "page", "Carteiras"],
      ["/carteiras/nova", "modal", "Carteiras"],
      ["/entrar", "public", "Entrada"],
    ]);
    expect(screen("/carteiras/[walletId]", "page").params).toEqual(["walletId"]);
  });

  it("segue só o componente usado: a tela não ganha a action do componente vizinho", () => {
    const page = screen("/carteiras/nova", "page");
    expect(page.actions).toEqual([`${W}/features/wallets/server/actions.ts#createWalletAction`]);
    expect(page.clientComponents).toEqual([`${W}/features/wallets/ui/forms.tsx`]);
  });

  it("anota o que a tela carrega no servidor (só funções), a sessão, o título e a ajuda", () => {
    const page = screen("/carteiras/nova", "page");
    expect(page.loaders).toEqual([`${W}/features/wallets/server/queries.ts#getWalletsPage`]);
    expect(page.session).toBe("user");
    expect(page.title).toBe("Nova carteira");
    expect(page.help).toBe("carteiras");
    expect(screen("/carteiras/nova", "modal").session).toBe("none");
  });

  it("lê os ?campos da tela e a quem ela os entrega inteiros", () => {
    const page = screen("/carteiras/nova", "page");
    expect(page.searchParams).toEqual(["id", "mes", "volta"]);
    expect(page.searchParamsTo).toEqual([`${W}/features/wallets/server/queries.ts#getWalletsPage`]);
  });

  it("acha os links (sem ?filtro e #âncora, com o molde do endereço dinâmico) e o menu da moldura", () => {
    expect(screen("/carteiras/nova", "page").links).toEqual(["/ajuda", "/carteiras/[…]"]);
    expect(screen("/", "layout").links).toEqual(["/carteiras"]);
    expect(screen("/", "layout").title).toBe("Moldura do app (menu)");
  });

  it("anota as chamadas do navegador ao Better Auth, sem descer nos primitivos de components/ui", () => {
    const entrar = screen("/entrar", "public");
    expect(entrar.authCalls).toEqual(["signIn.email"]);
    expect(entrar.links).toEqual(["/cadastro"]);
  });
});

describe("as funções do servidor", () => {
  it("diz o que chega: o schema da própria action (com a base) e o formulário, não o dos ajudantes", () => {
    expect(action("createWalletAction").input).toEqual(["color-hex", "kind", "name", "nota"]);
  });

  it("diz a permissão, o aviso ao cache, o redirect, a regra pura e a função do banco", () => {
    const a = action("createWalletAction");
    expect(a.permissions).toEqual(["manage_wallet"]);
    expect(a.financeChanged).toBe(true);
    expect(a.redirects).toEqual(["/carteiras/[…]"]);
    expect(a.rules).toEqual(["packages/core/src/index.ts#toCents"]);
    expect(a.db).toEqual(["packages/db/src/wallets.ts#createWallet"]);
  });

  it("acha as tabelas pelo cliente do Prisma e pelo SQL escrito à mão, dentro do packages/db", () => {
    const byName = Object.fromEntries(map.db.map((d) => [d.name, d.tables]));
    expect(byName.createWallet).toEqual(["AuditLog", "Wallet"]);
    expect(byName.listWallets).toEqual(["FinancialAccount", "Wallet"]);
    expect(action("syncWalletAction").tables).toEqual(["Wallet"]);
  });

  it("acha a fila pelo nome da constante e anota quem põe trabalho nela", () => {
    expect(action("syncWalletAction").enqueues).toEqual(["wallet-sync"]);
    const sync = map.queues.find((q) => q.name === "wallet-sync");
    expect(sync?.enqueuedBy).toEqual([
      `${W}/features/wallets/server/actions.ts#syncWalletAction`,
      `${W}/features/wallets/server/jobs.ts#work(wallet-daily)`,
    ]);
    expect(sync?.worker?.db).toEqual(["packages/db/src/wallets.ts#listWallets"]);
    expect(sync?.worker?.services).toEqual(["smtp"]);
  });

  it("anota o horário fixo de uma fila", () => {
    expect(map.queues.find((q) => q.name === "wallet-daily")?.schedule).toBe("30 4 * * *");
  });

  it("segue o Better Auth só a partir da rota /api/auth (as outras só pedem a sessão)", () => {
    const byRoute = Object.fromEntries(map.apis.map((a) => [a.route, a]));
    expect(byRoute["/api/auth/[...all]"]?.methods).toEqual(["GET", "POST"]);
    expect(byRoute["/api/auth/[...all]"]?.services).toEqual(["smtp"]);
    expect(byRoute["/api/health"]?.services).toEqual([]);
  });

  it("dá sempre o mesmo mapa para o mesmo código", () => {
    expect(serialize(analyze(root))).toBe(serialize(map));
  });
});
