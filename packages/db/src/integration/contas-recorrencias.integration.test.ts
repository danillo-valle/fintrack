// Contas, cartões e recorrências contra o Postgres (M07).
//
// Rode com: pnpm test:integration
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  authorizeAccountUse,
  authorizeScope,
  authorizeWallet,
  DomainError,
  type WalletGrant,
} from "../access";
import {
  createAccount,
  createCard,
  listUsableAccounts,
  listWalletAccounts,
  setAccountArchived,
} from "../accounts";
import {
  archiveRecurrence,
  createRecurrence,
  generateRecurrences,
  listRecurrences,
} from "../recurrences";
import {
  auditActions,
  createLoosePerson,
  createTestCategories,
  createTestHousehold,
  dbError,
  deletePeople,
  deleteTestHousehold,
  prisma,
  TEST_CTX,
  type TestHousehold,
} from "./fixtures";

let h: TestHousehold;
let other: TestHousehold;
beforeEach(async () => {
  [h, other] = await Promise.all([createTestHousehold(), createTestHousehold()]);
});
afterEach(async () => {
  await Promise.all([deleteTestHousehold(h), deleteTestHousehold(other)]);
});

async function walletGrant<A extends "view" | "edit" | "manage_accounts">(
  userId: string,
  walletId: string,
  action: A,
): Promise<WalletGrant<A>> {
  const access = await authorizeWallet(prisma, userId, walletId, action);
  if (!access.ok) throw new Error(`esperava ${action}, veio ${access.reason}`);
  return access.grant;
}

describe("contas e cartões", () => {
  it("o dono cria conta de cartão (com fechamento e vencimento) e audita", async () => {
    const grant = await walletGrant(h.holder.id, h.home.id, "manage_accounts");
    const account = await createAccount(
      prisma,
      grant,
      { name: "Cartão da Casa", kind: "CREDIT_CARD", closingDay: 5, dueDay: 12 },
      TEST_CTX,
    );
    expect([account.holderId, account.closingDay, account.dueDay]).toEqual([h.holder.id, 5, 12]);
    expect(await auditActions(h.householdId)).toContain("account.created");
    const listed = await listWalletAccounts(
      prisma,
      await walletGrant(h.holder.id, h.home.id, "view"),
    );
    expect(listed.map((a) => a.name)).toContain("Cartão da Casa");
  });

  it("conta corrente ignora fechamento e vencimento (o banco exige só no cartão)", async () => {
    const grant = await walletGrant(h.holder.id, h.home.id, "manage_accounts");
    const account = await createAccount(
      prisma,
      grant,
      {
        name: "Conta da Casa",
        kind: "CHECKING",
        closingDay: 5,
        dueDay: 12,
        initialBalance: 123456n,
      },
      TEST_CTX,
    );
    expect([account.closingDay, account.dueDay, account.initialBalance.toString()]).toEqual([
      null,
      null,
      "1234.56",
    ]);
  });

  it("editor não gerencia contas (ROLE)", async () => {
    await prisma.walletMember.update({
      where: { walletId_userId: { walletId: h.home.id, userId: h.partner.id } },
      data: { role: "EDITOR" },
    });
    expect(await authorizeWallet(prisma, h.partner.id, h.home.id, "manage_accounts")).toEqual({
      ok: false,
      reason: "ROLE",
    });
  });

  it("cartão: portador precisa ser do lar; só 4 dígitos (o CHECK do banco recusa letra)", async () => {
    const grant = await walletGrant(h.holder.id, h.holderWallet.id, "manage_accounts");
    const outsider = await createLoosePerson("fora");
    try {
      const error = await createCard(
        prisma,
        grant,
        h.card.id,
        {
          nickname: "X",
          brand: "Visa",
          lastFour: "1234",
          form: "PHYSICAL",
          isAdditional: false,
          holderId: outsider.id,
        },
        TEST_CTX,
      ).catch((e) => e);
      expect((error as DomainError).code).toBe("CARD_HOLDER_OUTSIDE_HOUSEHOLD");
    } finally {
      await deletePeople([outsider.id]);
    }
    expect(
      await dbError(
        createCard(
          prisma,
          grant,
          h.card.id,
          { nickname: "X", brand: "Visa", lastFour: "12a4", form: "PHYSICAL", isAdditional: false },
          TEST_CTX,
        ),
      ),
    ).toContain("payment_card_last_four_check");
  });

  it("IDOR: arquivar conta de outra carteira pelo id do formulário dá NOT_FOUND", async () => {
    const grant = await walletGrant(h.holder.id, h.home.id, "manage_accounts");
    const error = await setAccountArchived(prisma, grant, other.checking.id, true, TEST_CTX).catch(
      (e) => e,
    );
    expect((error as DomainError).code).toBe("NOT_FOUND");
  });

  it("contas usáveis: as das carteiras que a pessoa edita e a do cartão adicional", async () => {
    const partner = await listUsableAccounts(prisma, h.partner.id);
    const names = partner.map((a) => a.name).sort();
    expect(names).toEqual(["Cartão Master", "Vale"]);
    // Pelo adicional, ela só vê o próprio cartão daquela conta
    expect(partner.find((a) => a.name === "Cartão Master")?.cards.map((c) => c.id)).toEqual([
      h.additionalCard.id,
    ]);
  });
});

describe("recorrências", () => {
  async function rent(overrides: Partial<Parameters<typeof createRecurrence>[3]> = {}) {
    const cats = await createTestCategories(h.householdId);
    const account = await authorizeAccountUse(prisma, h.holder.id, h.checking.id);
    if (!account.ok) throw new Error("crachá");
    return createRecurrence(
      prisma,
      await walletGrant(h.holder.id, h.home.id, "edit"),
      account.grant,
      {
        kind: "FIXED_BILL",
        description: "Aluguel",
        cents: 250000n,
        dayOfMonth: 31,
        startsOn: "2026-01-01",
        categoryId: cats.mercado.id,
        ...overrides,
      },
      TEST_CTX,
    );
  }
  const editScope = () => authorizeScope(prisma, h.holder.id, "edit");

  it("gerar o mês cria um lançamento agendado; gerar de novo cria zero (idempotente)", async () => {
    const recurrence = await rent();
    expect(await generateRecurrences(prisma, await editScope(), "2026-02", TEST_CTX)).toEqual({
      created: 1,
    });
    expect(await generateRecurrences(prisma, await editScope(), "2026-02", TEST_CTX)).toEqual({
      created: 0,
    });
    const row = await prisma.transaction.findFirstOrThrow({
      where: { recurrenceId: recurrence.id },
    });
    expect([row.status, row.source, row.externalId, row.amount.toString()]).toEqual([
      "SCHEDULED",
      "RECURRENCE",
      `${recurrence.id}:2026-02`,
      "-2500",
    ]);
    expect(row.occurredOn.toISOString().slice(0, 10)).toBe("2026-02-28"); // dia 31 em fevereiro
    expect(row.categorizedBy).toBe("MANUAL");
    expect(await auditActions(h.householdId)).toEqual([
      "recurrence.created",
      "recurrences.generated",
    ]);
  });

  it("antes do início, depois do fim ou arquivada: nada é gerado", async () => {
    const recurrence = await rent({ startsOn: "2026-03-01", endsOn: "2026-04-30" });
    expect(
      (await generateRecurrences(prisma, await editScope(), "2026-02", TEST_CTX)).created,
    ).toBe(0);
    expect(
      (await generateRecurrences(prisma, await editScope(), "2026-05", TEST_CTX)).created,
    ).toBe(0);
    await archiveRecurrence(
      prisma,
      await walletGrant(h.holder.id, h.home.id, "edit"),
      recurrence.id,
      TEST_CTX,
    );
    expect(
      (await generateRecurrences(prisma, await editScope(), "2026-03", TEST_CTX)).created,
    ).toBe(0);
  });

  it("receita entra positiva; quem só vê a carteira não gera (escopo de edit vazio)", async () => {
    await rent({ kind: "INCOME", description: "Salário", categoryId: null });
    const listed = await listRecurrences(prisma, await authorizeScope(prisma, h.holder.id, "view"));
    expect(listed[0]?.amount).toBe(250000n);
    await prisma.walletMember.update({
      where: { walletId_userId: { walletId: h.home.id, userId: h.partner.id } },
      data: { role: "VIEWER" },
    });
    const partnerScope = await authorizeScope(prisma, h.partner.id, "edit");
    expect(partnerScope.walletIds).not.toContain(h.home.id);
  });

  it("IDOR: arquivar recorrência de outra carteira dá NOT_FOUND", async () => {
    const recurrence = await rent();
    const error = await archiveRecurrence(
      prisma,
      await walletGrant(other.holder.id, other.home.id, "edit"),
      recurrence.id,
      TEST_CTX,
    ).catch((e) => e);
    expect((error as DomainError).code).toBe("NOT_FOUND");
  });
});
