import { describe, expect, it } from "vitest";
import type { CategoryNode } from "./budget";
import type { BudgetRecord, SpendingRow } from "./dashboard";
import { decimalToCents } from "./money";
import { monthSummary, summaryPeriod, SUMMARY_LIMIT, type NewRecurrence } from "./month-summary";

const brl = decimalToCents;
const CASA = "casa";
const LIA = "lia";
const TODAY = "2026-10-16";

const nodes: CategoryNode[] = [
  { id: "alimentacao", parentId: null },
  { id: "mercado", parentId: "alimentacao" },
  { id: "restaurantes", parentId: "alimentacao" },
  { id: "saude", parentId: null },
  { id: "farmacia", parentId: "saude" },
  { id: "lazer", parentId: null },
  { id: "casa-contas", parentId: null },
];

const row = (r: Partial<SpendingRow> & Pick<SpendingRow, "month">): SpendingRow => ({
  walletId: CASA,
  categoryId: "mercado",
  payer: null,
  nature: "variable",
  upToToday: true,
  expense: 0n,
  income: 0n,
  firstAfterToday: null,
  ...r,
});

const SIX = ["2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09"] as const;
const history = (categoryId: string, value: string, walletId = CASA) =>
  SIX.map((month) => row({ month, categoryId, walletId, expense: brl(value) }));

const budget = (categoryId: string, value: string, month = "2026-10"): BudgetRecord => ({
  walletId: CASA,
  categoryId,
  month,
  cents: brl(value),
  shares: [],
});

const recurrence = (r: Partial<NewRecurrence>): NewRecurrence => ({
  id: "rec-1",
  kind: "SUBSCRIPTION",
  walletId: CASA,
  categoryId: "lazer",
  description: "STREAMFLIX",
  monthly: brl("39.90"),
  startsOn: "2026-10-11",
  ...r,
});

const summary = (input: Partial<Parameters<typeof monthSummary>[0]>) =>
  monthSummary({
    month: "2026-10",
    mode: "current",
    today: TODAY,
    rows: [],
    pending: [],
    budgets: [],
    nodes,
    recurrences: [],
    ...input,
  });

describe("de qual mês é o resumo", () => {
  it.each([
    ["2026-10-01", "2026-09", "closed"],
    ["2026-10-05", "2026-09", "closed"],
    ["2026-10-06", "2026-10", "current"],
    ["2026-10-31", "2026-10", "current"],
    ["2026-01-03", "2025-12", "closed"],
  ])("em %s, o de %s (%s)", (today, month, mode) => {
    expect(summaryPeriod(today)).toEqual({ month, mode });
  });
});

describe("as três observações", () => {
  it("orçado que deve estourar: o previsto passa do orçado (o peso é quanto passa)", () => {
    // Dia 16 de 31: 700 até hoje, no ritmo de 700/16 por dia → previsto 1.356,25 contra 1.000
    const s = summary({
      rows: [row({ month: "2026-10", expense: brl("700.00") })],
      budgets: [budget("mercado", "1000.00")],
    });
    expect(s.observations).toHaveLength(1);
    expect(s.observations[0]).toMatchObject({
      kind: "OVER_BUDGET",
      categoryId: "mercado",
      walletId: CASA,
      amount: brl("1356.25"),
      budget: brl("1000.00"),
      by: brl("356.25"),
    });
  });

  it("no mês fechado, o gasto de verdade (sem projeção)", () => {
    const s = summary({
      month: "2026-09",
      mode: "closed",
      today: "2026-10-03",
      rows: [row({ month: "2026-09", expense: brl("1100.00") })],
      budgets: [budget("mercado", "1000.00", "2026-09")],
    });
    expect(s.observations[0]).toMatchObject({ kind: "OVER_BUDGET", amount: brl("1100.00") });
  });

  it("acima do costume: mais de 20 % e de R$ 50 acima da média de 6 meses, por grupo", () => {
    const s = summary({
      rows: [
        ...history("restaurantes", "300.00"),
        row({ month: "2026-10", categoryId: "restaurantes", expense: brl("412.80") }),
      ],
    });
    expect(s.observations).toEqual([
      expect.objectContaining({
        kind: "ABOVE_USUAL",
        categoryId: "alimentacao",
        spent: brl("412.80"),
        average: brl("300.00"),
        percent: 38n,
        weight: brl("112.80"),
      }),
    ]);
  });

  it.each([
    ["só 20 % acima", "360.00", "300.00", 6],
    ["menos de R$ 50 acima", "140.00", "100.00", 6],
    ["média com só 2 meses de gasto", "900.00", "300.00", 2],
  ])("não é acima do costume: %s", (_, spent, average, months) => {
    const s = summary({
      rows: [
        ...history("farmacia", average).slice(6 - months),
        row({ month: "2026-10", categoryId: "farmacia", expense: brl(spent) }),
      ],
    });
    expect(s.observations.filter((o) => o.kind === "ABOVE_USUAL")).toEqual([]);
  });

  it("conta fixa ou assinatura nova: só as que começaram no mês (o peso é 12 meses)", () => {
    const s = summary({
      recurrences: [
        recurrence({}),
        recurrence({ id: "antiga", startsOn: "2026-08-01", categoryId: "casa-contas" }),
      ],
    });
    expect(s.observations).toEqual([
      expect.objectContaining({ kind: "NEW_RECURRING", yearly: brl("478.80") }),
    ]);
  });
});

describe("a escolha", () => {
  it(`as ${SUMMARY_LIMIT} de maior peso, no máximo uma por grupo de categoria`, () => {
    const s = summary({
      rows: [
        // Mercado estoura (passa 356,25) e Alimentação fica acima do costume: mesmo grupo
        ...history("mercado", "500.00"),
        row({ month: "2026-10", expense: brl("700.00") }),
        // Farmácia acima do costume: 400 contra 200 (peso 200)
        ...history("farmacia", "200.00"),
        row({ month: "2026-10", categoryId: "farmacia", expense: brl("400.00") }),
      ],
      budgets: [budget("mercado", "1000.00")],
      recurrences: [
        recurrence({}), // 478,80 por ano
        recurrence({ id: "outra", categoryId: "casa-contas", monthly: brl("5.00") }), // 60,00
      ],
    });
    expect(s.observations.map((o) => o.kind)).toEqual([
      "NEW_RECURRING",
      "OVER_BUDGET",
      "ABOVE_USUAL",
    ]);
    const above = s.observations.find((o) => o.kind === "ABOVE_USUAL");
    expect(above).toMatchObject({ categoryId: "saude" });
    expect(s.absent).toEqual([]);
  });

  it("o que não teve nenhum candidato vai em absent (a frase do resumo curto)", () => {
    const s = summary({
      rows: [
        ...history("restaurantes", "300.00"),
        row({ month: "2026-10", categoryId: "restaurantes", expense: brl("412.80") }),
      ],
      recurrences: [recurrence({ startsOn: "2026-07-01" })],
    });
    expect(s.observations).toHaveLength(1);
    expect(s.absent).toEqual(["OVER_BUDGET", "NEW_RECURRING"]);
  });

  it("nada fora do costume: nenhuma observação, os três tipos ausentes", () => {
    const s = summary({ rows: history("mercado", "500.00") });
    expect(s.observations).toEqual([]);
    expect(s.absent).toEqual(["OVER_BUDGET", "ABOVE_USUAL", "NEW_RECURRING"]);
  });

  it("recorrência sem categoria conta como um grupo próprio", () => {
    const s = summary({
      recurrences: [
        recurrence({ id: "a", categoryId: null }),
        recurrence({ id: "b", categoryId: null, monthly: brl("20.00") }),
      ],
    });
    expect(s.observations).toHaveLength(2);
  });

  it("outro ambiente que não está no recorte não entra (as linhas já vêm do escopo)", () => {
    const s = summary({
      rows: [row({ month: "2026-10", walletId: LIA, expense: brl("700.00") })],
      budgets: [budget("mercado", "1000.00")],
    });
    expect(s.observations).toEqual([]);
  });
});
