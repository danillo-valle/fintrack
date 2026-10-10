// Orçamento, agregações do painel e fluxo de caixa contra o Postgres (M08).
//
// Rode com: pnpm test:integration
import {
  cashDateFor,
  decimalToCents,
  figuresFor,
  resolvePayer,
  SHARED_PAYER_PARAM,
  spendingNature,
  type BudgetShare,
} from "@fintrack/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { authorizeScope, authorizeWallet, DomainError, type WalletGrant } from "../access";
import { copyBudgets, listBudgets, setBudget, undoCopyBudgets } from "../budgets";
import { cashRows, recurrencePlans, spendingRows } from "../dashboard";
import { removeHouseholdMember } from "../households";
import { listTransactions, sumTransactions } from "../transactions";
import { authorizeHousehold } from "../access";
import {
  auditActions,
  createTestHousehold,
  dbError,
  deleteTestHousehold,
  prisma,
  TEST_CTX,
  type TestHousehold,
} from "./fixtures";

let h: TestHousehold;
let cats: { alimentacao: string; mercado: string; feira: string; moradia: string };

beforeEach(async () => {
  h = await createTestHousehold();
  const make = (name: string, parentId: string | null = null) =>
    prisma.category.create({
      data: { householdId: h.householdId, name, kind: "EXPENSE", parentId },
    });
  const alimentacao = await make("Alimentação");
  const [mercado, feira, moradia] = await Promise.all([
    make("Mercado", alimentacao.id),
    make("Feira", alimentacao.id),
    make("Moradia"),
  ]);
  cats = {
    alimentacao: alimentacao.id,
    mercado: mercado!.id,
    feira: feira!.id,
    moradia: moradia!.id,
  };
});
afterEach(async () => {
  await deleteTestHousehold(h);
});

async function grant(userId: string, walletId: string): Promise<WalletGrant<"edit">> {
  const access = await authorizeWallet(prisma, userId, walletId, "edit");
  if (!access.ok) throw new Error(`esperava edit, veio ${access.reason}`);
  return access.grant;
}
const scopeOf = (userId: string) => authorizeScope(prisma, userId, "view");
const domainCode = (p: Promise<unknown>) =>
  p.then(
    () => "passou",
    (e: unknown) => (e instanceof DomainError ? e.code : String(e)),
  );
const brl = decimalToCents;
const shares = (...list: [string, string][]): BudgetShare[] =>
  list.map(([payer, value]) => ({ payer, cents: brl(value) }));

describe("orçado por ambiente e por pessoa", () => {
  it("grava a divisão; as partes somam o valor; a listagem devolve as partes", async () => {
    await setBudget(
      prisma,
      await grant(h.holder.id, h.home.id),
      {
        categoryId: cats.mercado,
        month: "2026-10",
        cents: brl("1400"),
        shares: shares([h.holder.id, "600"], [h.partner.id, "500"], [SHARED_PAYER_PARAM, "300"]),
      },
      TEST_CTX,
    );
    const [budget] = await listBudgets(prisma, await scopeOf(h.holder.id), "2026-10", "2026-10");
    expect(budget).toMatchObject({
      walletId: h.home.id,
      categoryId: cats.mercado,
      cents: brl("1400"),
    });
    expect(new Set(budget?.shares.map((s) => s.payer))).toEqual(
      new Set([h.holder.id, h.partner.id, SHARED_PAYER_PARAM]),
    );
    expect(await auditActions(h.householdId)).toContain("budget.set");
  });

  it("recusa: soma errada, divisão em ambiente pessoal, pessoa de fora, valor negativo", async () => {
    const home = await grant(h.holder.id, h.home.id);
    const base = { categoryId: cats.mercado, month: "2026-10", cents: brl("1400") };
    expect(
      await domainCode(
        setBudget(prisma, home, { ...base, shares: shares([h.holder.id, "600"]) }, TEST_CTX),
      ),
    ).toBe("SHARES_SUM_MISMATCH");
    expect(
      await domainCode(
        setBudget(
          prisma,
          await grant(h.holder.id, h.holderWallet.id),
          { ...base, shares: shares([h.holder.id, "1400"]) },
          TEST_CTX,
        ),
      ),
    ).toBe("BUDGET_SHARES_PERSONAL");
    expect(
      await domainCode(
        setBudget(prisma, home, { ...base, shares: shares(["alguem-de-fora", "1400"]) }, TEST_CTX),
      ),
    ).toBe("NOT_FOUND");
    expect(
      await domainCode(setBudget(prisma, home, { ...base, cents: -1n, shares: [] }, TEST_CTX)),
    ).toBe("BUDGET_AMOUNT_INVALID");
  });

  it("regra do nível: não orça Alimentação com Mercado já orçado", async () => {
    const home = await grant(h.holder.id, h.home.id);
    await setBudget(
      prisma,
      home,
      { categoryId: cats.mercado, month: "2026-10", cents: brl("1400"), shares: [] },
      TEST_CTX,
    );
    expect(
      await domainCode(
        setBudget(
          prisma,
          home,
          { categoryId: cats.alimentacao, month: "2026-10", cents: brl("2000"), shares: [] },
          TEST_CTX,
        ),
      ),
    ).toBe("BUDGET_LEVEL_CONFLICT");
    // Em outro ambiente pode: a regra vale dentro do mesmo ambiente e mês
    await setBudget(
      prisma,
      await grant(h.holder.id, h.holderWallet.id),
      { categoryId: cats.alimentacao, month: "2026-10", cents: brl("300"), shares: [] },
      TEST_CTX,
    );
  });

  it("valor zero sem divisão apaga o orçado (e audita)", async () => {
    const home = await grant(h.holder.id, h.home.id);
    await setBudget(
      prisma,
      home,
      { categoryId: cats.feira, month: "2026-10", cents: brl("250"), shares: [] },
      TEST_CTX,
    );
    expect(
      await setBudget(
        prisma,
        home,
        { categoryId: cats.feira, month: "2026-10", cents: 0n, shares: [] },
        TEST_CTX,
      ),
    ).toEqual({
      removed: true,
    });
    expect(await listBudgets(prisma, await scopeOf(h.holder.id), "2026-10", "2026-10")).toEqual([]);
    expect(await auditActions(h.householdId)).toContain("budget.removed");
  });

  it("o banco recusa parte negativa e dois Compartilhados no mesmo orçado (regras à mão)", async () => {
    const budget = await prisma.budget.create({
      data: {
        householdId: h.householdId,
        walletId: h.home.id,
        categoryId: cats.mercado,
        month: new Date("2026-10-01T00:00:00Z"),
        amount: "100",
      },
    });
    expect(
      await dbError(
        prisma.budgetShare.create({
          data: {
            householdId: h.householdId,
            budgetId: budget.id,
            userId: h.holder.id,
            amount: "-1",
          },
        }),
      ),
    ).toContain("budget_share_amount_check");
    await prisma.budgetShare.create({
      data: { householdId: h.householdId, budgetId: budget.id, userId: null, amount: "50" },
    });
    expect(
      await dbError(
        prisma.budgetShare.create({
          data: { householdId: h.householdId, budgetId: budget.id, userId: null, amount: "50" },
        }),
      ),
    ).toContain("budget_share_shared_once");
  });

  it("quem sai do lar perde a parte (a chave composta leva a parte junto)", async () => {
    await setBudget(
      prisma,
      await grant(h.holder.id, h.home.id),
      {
        categoryId: cats.mercado,
        month: "2026-10",
        cents: brl("1000"),
        shares: shares([h.holder.id, "600"], [h.partner.id, "400"]),
      },
      TEST_CTX,
    );
    const owner = await authorizeHousehold(prisma, h.holder.id, "remove_member");
    if (!owner.ok) throw new Error("esperava ser dono do lar");
    await removeHouseholdMember(prisma, owner.grant, h.partner.id, TEST_CTX);
    const [budget] = await listBudgets(prisma, await scopeOf(h.holder.id), "2026-10", "2026-10");
    expect(budget?.shares).toEqual([{ payer: h.holder.id, cents: brl("600") }]);
    expect(budget?.cents).toBe(brl("1000"));
  });
});

describe("copiar do mês anterior", () => {
  it("copia só o que falta, com a divisão; a segunda vez não copia nada; desfazer apaga", async () => {
    const home = await grant(h.holder.id, h.home.id);
    for (const [categoryId, value] of [
      [cats.mercado, "1400"],
      [cats.moradia, "2200"],
    ] as const) {
      await setBudget(
        prisma,
        home,
        {
          categoryId,
          month: "2026-09",
          cents: brl(value),
          shares:
            categoryId === cats.mercado
              ? shares([h.holder.id, "900"], [SHARED_PAYER_PARAM, "500"])
              : [],
        },
        TEST_CTX,
      );
    }
    await setBudget(
      prisma,
      home,
      { categoryId: cats.moradia, month: "2026-10", cents: brl("2300"), shares: [] },
      TEST_CTX,
    );

    const first = await copyBudgets(prisma, home, "2026-09", "2026-10", TEST_CTX);
    expect(first).toMatchObject({ copied: 1, kept: 1, copiedCategoryIds: [cats.mercado] });
    const october = await listBudgets(prisma, await scopeOf(h.holder.id), "2026-10", "2026-10");
    expect(october.find((b) => b.categoryId === cats.moradia)?.cents).toBe(brl("2300")); // não sobrescreve
    expect(october.find((b) => b.categoryId === cats.mercado)?.shares).toHaveLength(2);

    expect(await copyBudgets(prisma, home, "2026-09", "2026-10", TEST_CTX)).toMatchObject({
      copied: 0,
      kept: 2,
    });

    expect(
      await undoCopyBudgets(prisma, home, "2026-10", first.copiedCategoryIds, new Date(), TEST_CTX),
    ).toEqual({ removed: 1 });
    expect(await auditActions(h.householdId)).toEqual(
      expect.arrayContaining(["budgets.copied", "budgets.copy_undone"]),
    );
  });
});

describe("agregações do painel", () => {
  async function seedOctober() {
    await prisma.paymentCard.update({
      where: { id: h.additionalCard.id },
      data: { sharedPurchases: false },
    });
    const sharedCard = await prisma.paymentCard.create({
      data: {
        accountId: h.card.id,
        holderId: h.holder.id,
        nickname: "Conjunto",
        brand: "Mastercard",
        lastFour: "3333",
        form: "PHYSICAL",
        sharedPurchases: true,
      },
    });
    const rec = await prisma.recurrence.create({
      data: {
        householdId: h.householdId,
        walletId: h.home.id,
        accountId: h.checking.id,
        categoryId: cats.moradia,
        kind: "FIXED_BILL",
        method: "BOLETO",
        description: "Aluguel",
        amount: "-2200",
        dayOfMonth: 10,
        startsOn: new Date("2026-01-10T00:00:00Z"),
      },
    });
    const tx = (data: {
      amount: string;
      occurredOn: string;
      categoryId?: string | null;
      cardId?: string | null;
      accountId?: string;
      recurrenceId?: string;
      walletId?: string;
      status?: "CONFIRMED" | "SCHEDULED";
    }) =>
      prisma.transaction.create({
        data: {
          householdId: h.householdId,
          walletId: data.walletId ?? h.home.id,
          accountId: data.accountId ?? (data.cardId ? h.card.id : h.checking.id),
          cardId: data.cardId ?? null,
          method: data.cardId ? "CREDIT" : "PIX",
          categoryId: data.categoryId === undefined ? cats.mercado : data.categoryId,
          amount: data.amount,
          occurredOn: new Date(`${data.occurredOn}T00:00:00Z`),
          description: "Compra",
          status: data.status ?? "CONFIRMED",
          recurrenceId: data.recurrenceId ?? null,
          source: data.recurrenceId ? "RECURRENCE" : "MANUAL",
          externalId: data.recurrenceId
            ? `${data.recurrenceId}:${data.occurredOn.slice(0, 7)}`
            : null,
        },
      });
    await tx({ amount: "-230.10", occurredOn: "2026-10-02", cardId: h.holderCard.id });
    await tx({ amount: "-197.25", occurredOn: "2026-10-05", cardId: h.additionalCard.id });
    await tx({ amount: "-55.00", occurredOn: "2026-10-06", cardId: sharedCard.id });
    await tx({ amount: "-35.00", occurredOn: "2026-10-07", categoryId: cats.feira });
    await tx({
      amount: "8450",
      occurredOn: "2026-10-07",
      categoryId: null,
      walletId: h.holderWallet.id,
    });
    await tx({ amount: "-1298.40", occurredOn: "2026-09-15" });
    await tx({
      amount: "-2200",
      occurredOn: "2026-09-10",
      categoryId: cats.moradia,
      recurrenceId: rec.id,
    });
    return { sharedCard, rec };
  }

  it("Pago por e natureza: o SQL concorda com o core, lançamento por lançamento", async () => {
    await seedOctober();
    const scope = await scopeOf(h.holder.id);
    const filters = { from: "2026-09-01", to: "2026-10-31" };
    const { items } = await listTransactions(prisma, scope, filters, null, 500);
    const rows = await spendingRows(prisma, scope, {
      from: "2026-09",
      to: "2026-10",
      today: "2026-10-09",
    });
    expect(items.length).toBeGreaterThan(5);
    for (const item of items) {
      const payer = resolvePayer({ card: item.card, account: item.account });
      const key =
        payer.kind === "shared"
          ? SHARED_PAYER_PARAM
          : payer.kind === "person"
            ? payer.userId
            : null;
      const match = rows.find(
        (r) =>
          r.walletId === item.wallet.id &&
          r.categoryId === (item.category?.id ?? null) &&
          r.payer === key &&
          r.nature ===
            spendingNature({
              recurrenceId: item.recurrenceId,
              installmentGroupId: item.installment ? "grupo" : null,
            }),
      );
      expect(match, `linha para ${item.description} ${item.amount}`).toBeDefined();
    }
  });

  it("as somas do painel batem com os totais da lista (mesmo recorte)", async () => {
    await seedOctober();
    const scope = await scopeOf(h.holder.id);
    const rows = await spendingRows(prisma, scope, {
      from: "2026-09",
      to: "2026-10",
      today: "2026-10-31",
    });
    for (const month of ["2026-09", "2026-10"]) {
      const totals = await sumTransactions(prisma, scope, {
        from: `${month}-01`,
        to: `${month}-${month === "2026-09" ? "30" : "31"}`,
      });
      const expense = rows.filter((r) => r.month === month).reduce((s, r) => s + r.expense, 0n);
      const income = rows.filter((r) => r.month === month).reduce((s, r) => s + r.income, 0n);
      expect(expense).toBe(-totals.expense);
      expect(income).toBe(totals.income);
    }
    // E o recorte "Mercado + Feira (Alimentação), Pago por: parceira" bate com a lista filtrada
    const partnerAlimentacao = figuresFor(rows, [], "2026-10", {
      categories: new Set([cats.alimentacao, cats.mercado, cats.feira]),
      payer: h.partner.id,
    });
    const list = await sumTransactions(prisma, scope, {
      from: "2026-10-01",
      to: "2026-10-31",
      categoryId: cats.alimentacao,
      payer: { kind: "person", userId: h.partner.id },
    });
    expect(partnerAlimentacao.spent).toBe(-list.expense);
    expect(partnerAlimentacao.spent).toBe(brl("197.25"));
  });

  it("recorrências: o mês já lançado não volta como previsto", async () => {
    const { rec } = await seedOctober();
    const [plan] = await recurrencePlans(prisma, await scopeOf(h.holder.id), [
      "2026-09",
      "2026-10",
      "2026-11",
    ]);
    expect(plan?.id).toBe(rec.id);
    expect([...(plan?.materialized ?? [])]).toEqual(["2026-09"]);
    expect(plan?.payer).toBe(h.holder.id); // conta corrente da titular, sem cartão
  });

  it("fluxo de caixa: compra no cartão sai no vencimento da fatura", async () => {
    await seedOctober();
    const rows = await cashRows(prisma, await scopeOf(h.holder.id), "2026-10-01", "2026-12-31");
    const card = rows.find((r) => r.accountId === h.card.id && r.occurredOn === "2026-10-05");
    expect(card).toBeDefined();
    // O cartão do fixture fecha dia 3 e vence dia 9: compra em 05/10 vence em 09/11
    expect(cashDateFor(card!.occurredOn, card!.account, card!.statementDue)).toBe("2026-11-09");
    // Setembro entra (pode vencer em outubro); transferências nunca
    expect(rows.some((r) => r.occurredOn === "2026-09-15")).toBe(true);
  });

  it("o escopo manda: a parceira não vê o pessoal da titular", async () => {
    await seedOctober();
    const rows = await spendingRows(prisma, await scopeOf(h.partner.id), {
      from: "2026-10",
      to: "2026-10",
      today: "2026-10-09",
    });
    expect(rows.some((r) => r.walletId === h.holderWallet.id)).toBe(false);
    expect(rows.some((r) => r.walletId === h.home.id)).toBe(true);
  });
});
