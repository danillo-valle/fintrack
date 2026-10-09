// "Pago por", parcelas e despesas fixas contra o Postgres (M07.4, ADR-009).
//
// Rode com: pnpm test:integration
import { resolvePayer } from "@fintrack/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  authorizeAccountUse,
  authorizeScope,
  authorizeWallet,
  DomainError,
  type WalletGrant,
} from "../access";
import { setCardSharedPurchases } from "../accounts";
import { createInstallmentPurchase } from "../installments";
import { createFixedExpense, generateRecurrences } from "../recurrences";
import { createTransaction, listTransactions, sumTransactions } from "../transactions";
import {
  auditActions,
  createTestHousehold,
  deleteTestHousehold,
  prisma,
  TEST_CTX,
  type TestHousehold,
} from "./fixtures";

let h: TestHousehold;
beforeEach(async () => {
  h = await createTestHousehold();
});
afterEach(async () => {
  await deleteTestHousehold(h);
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
async function accountGrant(userId: string, accountId: string) {
  const access = await authorizeAccountUse(prisma, userId, accountId);
  if (!access.ok) throw new Error(`esperava usar a conta, veio ${access.reason}`);
  return access.grant;
}
const viewScope = (userId: string) => authorizeScope(prisma, userId, "view");
const OCTOBER = { from: "2026-10-01", to: "2026-10-31" } as const;

describe("compra parcelada", () => {
  async function buy(count: number, cents = 4235n, purchasedOn = "2026-10-08") {
    return createInstallmentPurchase(
      prisma,
      await walletGrant(h.holder.id, h.home.id, "edit"),
      await accountGrant(h.holder.id, h.card.id),
      {
        cents,
        count,
        description: "Notebook",
        purchasedOn,
        categoryId: null,
        cardId: h.holderCard.id,
      },
      { scope: await viewScope(h.holder.id) },
      TEST_CTX,
      "2026-10-08",
    );
  }

  it("vira N lançamentos, um por fatura, que somam o total ao centavo", async () => {
    const { groupId } = await buy(3);
    const rows = await prisma.transaction.findMany({
      where: { installmentGroupId: groupId },
      orderBy: { installmentNumber: "asc" },
      include: { statement: true },
    });
    expect(rows.map((r) => r.amount.toString())).toEqual(["-14.13", "-14.11", "-14.11"]);
    expect(rows.map((r) => r.status)).toEqual(["CONFIRMED", "SCHEDULED", "SCHEDULED"]);
    // O cartão do fixture fecha dia 3: compra em 08/10 cai na fatura de novembro
    expect(rows.map((r) => r.statement?.referenceMonth.toISOString().slice(0, 7))).toEqual([
      "2026-11",
      "2026-12",
      "2027-01",
    ]);
    expect(rows.map((r) => r.occurredOn.toISOString().slice(0, 10))).toEqual([
      "2026-10-08",
      "2026-11-08",
      "2026-12-08",
    ]);
    expect(await auditActions(h.householdId)).toContain("installment_purchase.created");
  });

  it("a fatura que já existe é reaproveitada (uma por mês e por conta)", async () => {
    await buy(2);
    await buy(2);
    const statements = await prisma.cardStatement.count({ where: { accountId: h.card.id } });
    expect(statements).toBe(2);
  });

  it("a lista de cada mês mostra só a parcela daquele mês, com 'k de N'", async () => {
    await buy(3);
    const scope = await viewScope(h.holder.id);
    const october = await listTransactions(prisma, scope, OCTOBER);
    expect(october.items.map((i) => i.installment)).toEqual([{ number: 1, count: 3 }]);
    const november = await listTransactions(prisma, scope, {
      from: "2026-11-01",
      to: "2026-11-30",
    });
    expect(november.items.map((i) => i.installment)).toEqual([{ number: 2, count: 3 }]);
  });

  it("só no cartão de crédito, e de 2 a 24 parcelas", async () => {
    const wallet = await walletGrant(h.holder.id, h.home.id, "edit");
    const options = { scope: await viewScope(h.holder.id) };
    const input = {
      cents: 1000n,
      count: 3,
      description: "x",
      purchasedOn: "2026-10-08",
      categoryId: null,
    };
    await expect(
      createInstallmentPurchase(
        prisma,
        wallet,
        await accountGrant(h.holder.id, h.checking.id),
        input,
        options,
        TEST_CTX,
      ),
    ).rejects.toEqual(new DomainError("INSTALLMENTS_NEED_CREDIT_CARD"));
    const card = await accountGrant(h.holder.id, h.card.id);
    for (const count of [1, 25]) {
      await expect(
        createInstallmentPurchase(prisma, wallet, card, { ...input, count }, options, TEST_CTX),
      ).rejects.toEqual(new DomainError("INSTALLMENT_COUNT_INVALID"));
    }
  });
});

describe("despesa fixa", () => {
  it("cria a recorrência e o lançamento do mês; 'Lançar as deste mês' não duplica", async () => {
    const wallet = await walletGrant(h.holder.id, h.home.id, "edit");
    const { recurrenceId, transactionId } = await createFixedExpense(
      prisma,
      wallet,
      await accountGrant(h.holder.id, h.checking.id),
      {
        kind: "SUBSCRIPTION",
        cents: 6990n,
        description: "Streaming",
        dayOfMonth: 12,
        occurredOn: "2026-10-12",
        categoryId: null,
      },
      TEST_CTX,
      "2026-10-12",
    );
    const created = await prisma.transaction.findUniqueOrThrow({ where: { id: transactionId } });
    expect([created.recurrenceId, created.status, created.amount.toString()]).toEqual([
      recurrenceId,
      "CONFIRMED",
      "-69.9",
    ]);
    const scope = await authorizeScope(prisma, h.holder.id, "edit");
    expect(await generateRecurrences(prisma, scope, "2026-10", TEST_CTX)).toEqual({ created: 0 });
    // O mês seguinte sai da recorrência, quando for gerado
    expect(await generateRecurrences(prisma, scope, "2026-11", TEST_CTX)).toEqual({ created: 1 });
  });
});

describe("pago por", () => {
  async function spend(accountId: string, cardId: string | null, description: string) {
    return createTransaction(
      prisma,
      await walletGrant(h.holder.id, h.home.id, "edit"),
      await accountGrant(h.holder.id, accountId),
      {
        kind: "expense",
        cents: 1000n,
        description,
        occurredOn: "2026-10-07",
        categoryId: null,
        cardId,
      },
      { scope: await viewScope(h.holder.id) },
      TEST_CTX,
    );
  }

  it("o filtro do banco e a regra do core concordam, linha por linha", async () => {
    await spend(h.checking.id, null, "Pix da titular");
    await spend(h.card.id, h.holderCard.id, "Cartão da titular");
    await spend(h.card.id, h.additionalCard.id, "Adicional da parceira");
    const manage = await walletGrant(h.holder.id, h.holderWallet.id, "manage_accounts");
    await setCardSharedPurchases(prisma, manage, h.additionalCard.id, true, TEST_CTX);
    await spend(h.card.id, h.additionalCard.id, "Mercado do casal");

    const scope = await viewScope(h.holder.id);
    const all = (await listTransactions(prisma, scope, OCTOBER)).items;
    const byPayer = async (payer: Parameters<typeof listTransactions>[2]["payer"]) =>
      (await listTransactions(prisma, scope, { ...OCTOBER, payer })).items
        .map((i) => i.description)
        .sort();

    // A marca vale para o passado também: é calculada, não guardada
    expect(await byPayer({ kind: "shared" })).toEqual([
      "Adicional da parceira",
      "Mercado do casal",
    ]);
    expect(await byPayer({ kind: "person", userId: h.holder.id })).toEqual([
      "Cartão da titular",
      "Pix da titular",
    ]);
    expect(await byPayer({ kind: "person", userId: h.partner.id })).toEqual([]);
    // Cada linha da lista diz o mesmo que o filtro
    for (const item of all) {
      expect(item.payer).toEqual(resolvePayer({ card: item.card, account: item.account }));
    }
    // E os totais usam o mesmo WHERE
    const shared = await sumTransactions(prisma, scope, { ...OCTOBER, payer: { kind: "shared" } });
    expect(shared.expense).toBe(-2000n);
    expect(await auditActions(h.householdId)).toContain("card.shared_purchases_changed");
  });

  it("marcar compras conjuntas pede o crachá de gerir contas da carteira do cartão", async () => {
    const otherWallet = await walletGrant(h.partner.id, h.partnerWallet.id, "manage_accounts");
    await expect(
      setCardSharedPurchases(prisma, otherWallet, h.holderCard.id, true, TEST_CTX),
    ).rejects.toEqual(new DomainError("NOT_FOUND"));
  });
});
