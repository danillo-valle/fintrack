// Testes do PLANO do seed: conferem, sem banco, as regras que os dados precisam respeitar.
// Se alguém mudar o gerador e quebrar uma regra (fatura que não bate, transferência que não
// zera, cartão fora da conta, crédito numa conta corrente), o pnpm test pega antes do seed
// chegar ao banco.
import { compareCivil, fitsInColumn, statementFor, sumCents, type CivilDate } from "@fintrack/core";
import { describe, expect, it } from "vitest";
import { buildSeedPlan, SEED_HOUSEHOLD_ID, type SeedPlan } from "./plan";

// Datas fixas: o teste dá o mesmo resultado em qualquer dia em que rodar
const TODAY: CivilDate = "2026-10-02";
const plan: SeedPlan = buildSeedPlan({ endMonth: "2026-10", today: TODAY });
const accountById = new Map(plan.accounts.map((a) => [a.id, a]));
const cardById = new Map(plan.cards.map((c) => [c.id, c]));
const walletById = new Map(plan.wallets.map((w) => [w.id, w]));

describe("plano do seed: estrutura", () => {
  it("é reprodutível: mesma semente, mesmos dados", () => {
    expect(buildSeedPlan({ endMonth: "2026-10", today: TODAY })).toEqual(plan);
  });

  it("tem o tamanho esperado de um grupo com 24 meses", () => {
    expect(plan.household.id).toBe(SEED_HOUSEHOLD_ID);
    expect(plan.users).toHaveLength(2);
    expect(plan.wallets.map((w) => w.kind).sort()).toEqual(["PERSONAL", "PERSONAL", "SHARED"]);
    expect(plan.transactions.length).toBeGreaterThan(1000);
    expect(plan.cards.length).toBeGreaterThanOrEqual(8);
    expect(plan.recurrences.length).toBeGreaterThanOrEqual(10);
  });

  it("cada pessoa tem um ambiente pessoal só dela; o compartilhado tem as duas", () => {
    for (const user of plan.users) {
      const own = plan.wallets.filter((w) => w.kind === "PERSONAL" && w.createdById === user.id);
      expect(own).toHaveLength(1);
      expect(own[0]?.members).toEqual([{ userId: user.id, role: "OWNER" }]);
    }
    const shared = plan.wallets.find((w) => w.kind === "SHARED");
    expect(shared?.members.map((m) => m.userId).sort()).toEqual(
      [...plan.users.map((u) => u.id)].sort(),
    );
  });

  it("cartões: só 4 dígitos, únicos, e adicional sempre de outra pessoa que não o titular", () => {
    const finals = plan.cards.map((c) => c.lastFour);
    expect(new Set(finals).size).toBe(finals.length);
    for (const c of plan.cards) {
      expect(c.lastFour).toMatch(/^[0-9]{4}$/);
      const account = accountById.get(c.accountId);
      if (c.isAdditional) expect(c.holderId).not.toBe(account?.holderId);
      else expect(c.holderId).toBe(account?.holderId);
    }
  });
});

describe("plano do seed: dinheiro", () => {
  it("valores negativos com centavos são exatos (o bug do brl('-129.90'))", () => {
    const gym = plan.recurrences.find((r) => r.description === "Academia Corpo em Forma");
    expect(gym?.amount).toBe(-12990n);
    expect(plan.recurrences.find((r) => r.description === "NETFLIX.COM")?.amount).toBe(-5590n);
  });

  it("nenhum valor é zero e todos cabem na coluna NUMERIC(14,2)", () => {
    for (const t of plan.transactions) {
      expect(t.amount).not.toBe(0n);
      expect(fitsInColumn(t.amount)).toBe(true);
    }
  });

  it("toda transferência tem dois lados, em contas diferentes, que somam zero", () => {
    const groups = Map.groupBy(
      plan.transactions.filter((t) => t.transferId),
      (t) => t.transferId,
    );
    expect(groups.size).toBeGreaterThan(100);
    for (const legs of groups.values()) {
      expect(legs).toHaveLength(2);
      expect(sumCents(legs.map((t) => t.amount))).toBe(0n);
      expect(legs[0]?.accountId).not.toBe(legs[1]?.accountId);
      expect(legs.every((t) => t.categoryId === null)).toBe(true);
    }
  });

  it("nenhuma conta corrente, de vale ou dinheiro fica negativa hoje", () => {
    for (const account of plan.accounts.filter((a) => a.kind !== "CREDIT_CARD")) {
      const balance =
        account.initialBalance +
        sumCents(
          plan.transactions
            .filter((t) => t.accountId === account.id && t.status !== "SCHEDULED")
            .map((t) => t.amount),
        );
      expect(balance, account.name).toBeGreaterThanOrEqual(0n);
    }
  });
});

describe("plano do seed: quem paga × de quem é", () => {
  it("forma de pagamento combina com a conta (a mesma regra do gatilho do banco)", () => {
    for (const t of plan.transactions) {
      const kind = accountById.get(t.accountId)?.kind;
      const isTransfer = t.transferId !== null;
      expect(t.method === "CREDIT" && kind !== "CREDIT_CARD").toBe(false);
      expect(kind === "CREDIT_CARD" && t.method !== "CREDIT" && !isTransfer).toBe(false);
      expect(t.method === "VOUCHER" && kind !== "MEAL_VOUCHER").toBe(false);
      expect(t.statementId !== null && kind !== "CREDIT_CARD").toBe(false);
    }
  });

  it("todo cartão usado é da conta do lançamento, e só com crédito, débito ou vale", () => {
    for (const t of plan.transactions.filter((x) => x.cardId)) {
      expect(cardById.get(t.cardId ?? "")?.accountId).toBe(t.accountId);
      expect(["CREDIT", "DEBIT", "VOUCHER"]).toContain(t.method);
    }
  });

  it("tem gasto da Casa pago no adicional do Caio na fatura da Lia (o 'CASAL' da planilha)", () => {
    const casal = plan.transactions.filter((t) => {
      const card = cardById.get(t.cardId ?? "");
      const account = accountById.get(t.accountId);
      return (
        walletById.get(t.walletId)?.kind === "SHARED" &&
        card?.isAdditional === true &&
        account?.walletId !== t.walletId
      );
    });
    expect(casal.length).toBeGreaterThan(20);
  });
});

describe("plano do seed: datas, faturas e parcelas", () => {
  it("nada passa de hoje, exceto parcelas futuras e agendados", () => {
    for (const t of plan.transactions) {
      expect(compareCivil(t.occurredOn, "2024-11-01")).toBeGreaterThanOrEqual(0);
      const future = compareCivil(t.occurredOn, TODAY) > 0;
      if (future) expect(t.installmentGroupId !== null || t.status === "SCHEDULED").toBe(true);
      if (t.status === "SCHEDULED") expect(future).toBe(true);
    }
  });

  it("compra no cartão está na fatura certa (competência), e conta comum não tem fatura", () => {
    for (const t of plan.transactions) {
      const account = accountById.get(t.accountId);
      if (account?.cycle && t.transferId === null && t.installmentGroupId === null) {
        const expected = statementFor(t.occurredOn, account.cycle).referenceMonth;
        expect(plan.statements.find((s) => s.id === t.statementId)?.referenceMonth).toBe(expected);
      }
      if (account?.kind !== "CREDIT_CARD") expect(t.statementId).toBeNull();
    }
  });

  it("fatura fechada tem total = soma das compras dela; fatura paga tem o pagamento", () => {
    for (const s of plan.statements) {
      const purchases = plan.transactions.filter((t) => t.statementId === s.id);
      if (s.status === "OPEN") {
        expect(s.total).toBeNull();
        continue;
      }
      expect(s.total).toBe(-sumCents(purchases.map((t) => t.amount)));
      if (s.status === "PAID" && s.total !== null && s.total > 0n) {
        const payment = plan.transactions.find(
          (t) => t.accountId === s.accountId && t.transferId && t.occurredOn === s.dueDate,
        );
        expect(payment?.amount).toBe(s.total);
      }
    }
  });

  it("parcelas: numeradas de 1 a N, somando o total da compra", () => {
    expect(plan.installmentGroups.length).toBeGreaterThanOrEqual(5);
    for (const g of plan.installmentGroups) {
      const parcels = plan.transactions.filter((t) => t.installmentGroupId === g.id);
      expect(parcels.map((p) => p.installmentNumber)).toEqual(
        Array.from({ length: g.installmentCount }, (_, i) => i + 1),
      );
      expect(sumCents(parcels.map((p) => p.amount))).toBe(g.totalAmount);
      expect(parcels.every((p) => p.walletId === g.walletId)).toBe(true);
    }
  });

  it("recorrência: um lançamento por mês, com a chave de origem única", () => {
    for (const r of plan.recurrences) {
      const occurrences = plan.transactions.filter((t) => t.recurrenceId === r.id);
      expect(occurrences.length, r.description).toBeGreaterThanOrEqual(23);
      expect(new Set(occurrences.map((t) => t.externalId)).size).toBe(occurrences.length);
      expect(occurrences.every((t) => t.source === "RECURRENCE" && t.walletId === r.walletId)).toBe(
        true,
      );
    }
  });

  it("estorno devolve exatamente o valor da compra original", () => {
    const reversals = plan.transactions.filter((t) => t.reversalOfId);
    expect(reversals.length).toBeGreaterThanOrEqual(4);
    for (const r of reversals) {
      const original = plan.transactions.find((t) => t.id === r.reversalOfId);
      expect(r.amount).toBe(-(original?.amount ?? 0n));
    }
  });

  it("respeita os CHECKs do banco: textos, regras e orçamento", () => {
    for (const t of plan.transactions) expect(t.description.length).toBeLessThanOrEqual(200);
    for (const c of plan.categories) expect(c.name.length).toBeLessThanOrEqual(60);
    for (const r of plan.rules) expect(r.pattern).toMatch(/^[a-z0-9 ]{2,100}$/);
    const budgetKeys = plan.budgets.map((b) => `${b.walletId}:${b.categoryId}:${b.month}`);
    expect(new Set(budgetKeys).size).toBe(budgetKeys.length);
    const external = plan.transactions
      .filter((t) => t.source !== "MANUAL")
      .map((t) => `${t.accountId}:${t.externalId}`);
    expect(external.every((key) => !key.endsWith(":null"))).toBe(true);
    expect(new Set(external).size).toBe(external.length);
  });
});
