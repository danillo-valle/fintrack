// A matriz de papéis contra o Postgres de verdade (M06): para CADA ação, CADA tipo de
// carteira e CADA papel, authorizeWallet precisa responder o mesmo que a regra pura
// (canInWallet, do @fintrack/core). E quem não participa recebe NOT_FOUND em tudo: é a
// prevenção de IDOR (OWASP A01:2025).
//
// Rode com: pnpm test:integration   (precisa do Postgres no ar: pnpm db:up)
import { randomUUID } from "node:crypto";
import {
  canInWallet,
  HOUSEHOLD_ACTIONS,
  WALLET_ACTIONS,
  WALLET_ROLES,
  canInHousehold,
  type WalletRole,
} from "@fintrack/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { authorizeHousehold, authorizeWallet, type WalletGrant } from "../access";
import { renameWallet } from "../wallets";
import {
  createLoosePerson,
  createTestHousehold,
  dbError,
  deletePeople,
  deleteTestHousehold,
  prisma,
  TEST_CTX,
  type TestHousehold,
} from "./fixtures";

let h: TestHousehold;
let other: TestHousehold; // outro lar, completo: a "vizinha" que tenta trocar o id na URL
let loose: { id: string }; // pessoa sem lar nenhum

beforeAll(async () => {
  [h, other] = await Promise.all([createTestHousehold(), createTestHousehold()]);
  loose = await createLoosePerson("avulsa");
});
afterAll(async () => {
  await Promise.all([deleteTestHousehold(h), deleteTestHousehold(other)]);
  await deletePeople([loose.id]);
});

/**
 * Coloca a parceira com o papel pedido na carteira do tipo pedido e devolve o id da carteira.
 * PESSOAL: a carteira pessoal da titular, com a parceira inserida direto no banco (o app não
 * deixa compartilhar a pessoal, mas o banco aceita, e a regra precisa negar mesmo assim).
 */
async function walletWithPartnerAs(kind: "PERSONAL" | "SHARED", role: WalletRole) {
  const walletId = kind === "SHARED" ? h.home.id : h.holderWallet.id;
  await prisma.walletMember.upsert({
    where: { walletId_userId: { walletId, userId: h.partner.id } },
    create: { householdId: h.householdId, walletId, userId: h.partner.id, role },
    update: { role },
  });
  return walletId;
}

describe("matriz da carteira: o banco + a regra respondem igual à tabela", () => {
  const rows = WALLET_ACTIONS.flatMap((action) =>
    (["PERSONAL", "SHARED"] as const).flatMap((kind) =>
      WALLET_ROLES.map((role) => ({ action, kind, role })),
    ),
  );

  it.each(rows)("$role · $action · $kind", async ({ action, kind, role }) => {
    const walletId = await walletWithPartnerAs(kind, role);
    const expected = canInWallet(role, action, { kind, archived: false });

    const result = await authorizeWallet(prisma, h.partner.id, walletId, action);

    if (expected.allowed) {
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.grant.role).toBe(role);
        expect(result.grant.wallet.id).toBe(walletId);
      }
    } else {
      expect(result).toEqual({ ok: false, reason: expected.reason });
    }
    // limpa a parceira da carteira pessoal da titular para o próximo caso
    if (kind === "PERSONAL") {
      await prisma.walletMember.delete({
        where: { walletId_userId: { walletId, userId: h.partner.id } },
      });
    }
  });
});

describe("IDOR: quem não participa recebe NOT_FOUND, nunca 'sem permissão'", () => {
  const actions = WALLET_ACTIONS;

  it.each(actions)("pessoa de OUTRO lar, carteira compartilhada, ação %s", async (action) => {
    const result = await authorizeWallet(prisma, other.holder.id, h.home.id, action);
    expect(result).toEqual({ ok: false, reason: "NOT_FOUND" });
  });

  it.each(actions)("pessoa de OUTRO lar, carteira pessoal, ação %s", async (action) => {
    const result = await authorizeWallet(prisma, other.holder.id, h.holderWallet.id, action);
    expect(result).toEqual({ ok: false, reason: "NOT_FOUND" });
  });

  it("do MESMO lar, mas fora da carteira pessoal da outra pessoa", async () => {
    // A parceira é do lar, mas a carteira pessoal da titular não é dela
    const result = await authorizeWallet(prisma, h.partner.id, h.holderWallet.id, "view");
    expect(result).toEqual({ ok: false, reason: "NOT_FOUND" });
  });

  it("pessoa sem lar", async () => {
    expect(await authorizeWallet(prisma, loose.id, h.home.id, "view")).toEqual({
      ok: false,
      reason: "NOT_FOUND",
    });
  });

  it("id que não existe dá a MESMA resposta que id de outra pessoa", async () => {
    const missing = await authorizeWallet(prisma, h.holder.id, randomUUID(), "view");
    const foreign = await authorizeWallet(prisma, h.holder.id, other.home.id, "view");
    expect(missing).toEqual(foreign);
    expect(missing).toEqual({ ok: false, reason: "NOT_FOUND" });
  });

  it.each(["nao-e-uuid", "", "1 OR 1=1", "../../etc/passwd", `${randomUUID()}x`])(
    "id fora do formato (%j) não chega ao banco e dá NOT_FOUND",
    async (bad) => {
      expect(await authorizeWallet(prisma, h.holder.id, bad, "view")).toEqual({
        ok: false,
        reason: "NOT_FOUND",
      });
    },
  );
});

describe("carteira arquivada", () => {
  it("o dono vê e desarquiva, mas não renomeia nem gerencia", async () => {
    await prisma.wallet.update({ where: { id: other.home.id }, data: { archivedAt: new Date() } });
    try {
      const id = other.home.id;
      expect((await authorizeWallet(prisma, other.holder.id, id, "view")).ok).toBe(true);
      expect((await authorizeWallet(prisma, other.holder.id, id, "archive")).ok).toBe(true);
      expect(await authorizeWallet(prisma, other.holder.id, id, "rename")).toEqual({
        ok: false,
        reason: "ARCHIVED",
      });
      expect(await authorizeWallet(prisma, other.holder.id, id, "manage_members")).toEqual({
        ok: false,
        reason: "ARCHIVED",
      });
    } finally {
      await prisma.wallet.update({ where: { id: other.home.id }, data: { archivedAt: null } });
    }
  });
});

describe("matriz do lar", () => {
  const rows = HOUSEHOLD_ACTIONS.flatMap((action) =>
    (["OWNER", "MEMBER"] as const).map((role) => ({ action, role })),
  );

  it.each(rows)("$role · $action", async ({ action, role }) => {
    // Na fixture, a titular é OWNER do lar e a parceira é MEMBER
    const person = role === "OWNER" ? h.holder : h.partner;
    const result = await authorizeHousehold(prisma, person.id, action);
    if (canInHousehold(role, action)) {
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.grant.household.id).toBe(h.householdId);
    } else {
      expect(result).toEqual({ ok: false, reason: "ROLE" });
    }
  });

  it("pessoa sem lar recebe NO_HOUSEHOLD", async () => {
    expect(await authorizeHousehold(prisma, loose.id, "view")).toEqual({
      ok: false,
      reason: "NO_HOUSEHOLD",
    });
  });
});

describe("o crachá velho não vale depois de uma mudança de papel", () => {
  it("dona rebaixada no meio do caminho não consegue renomear (STALE_GRANT)", async () => {
    // A parceira é dona da Casa e pega o crachá de "rename"...
    await walletWithPartnerAs("SHARED", "OWNER");
    const access = await authorizeWallet(prisma, h.partner.id, h.home.id, "rename");
    expect(access.ok).toBe(true);
    if (!access.ok) return;
    // ...mas, antes de gravar, a titular a rebaixa para VIEWER
    await prisma.walletMember.update({
      where: { walletId_userId: { walletId: h.home.id, userId: h.partner.id } },
      data: { role: "VIEWER" },
    });
    const error = await dbError(renameWallet(prisma, access.grant, "Tomada", TEST_CTX));
    expect(error).toContain("STALE_GRANT");
    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { id: h.home.id } });
    expect(wallet.name).toBe("Casa");
    await walletWithPartnerAs("SHARED", "OWNER"); // devolve o estado da fixture
  });
});

// ── Conferência em tempo de compilação ─────────────────────────────────────────
// Esta função nunca roda. Ela existe para o `pnpm typecheck` provar que o crachá é exigido:
// se uma das linhas marcadas com @ts-expect-error passar a compilar, o TypeScript reprova
// ("Unused '@ts-expect-error' directive").
export async function _compileTimeChecks(viewGrant: WalletGrant<"view">) {
  // @ts-expect-error crachá de "view" não serve para renomear
  await renameWallet(prisma, viewGrant, "x", TEST_CTX);

  const fake = { action: "rename" as const, userId: "u", role: "OWNER" as const, wallet: h.home };
  // @ts-expect-error um objeto qualquer com os mesmos campos não é crachá
  await renameWallet(prisma, fake, "x", TEST_CTX);
}
