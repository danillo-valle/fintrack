import { describe, expect, it } from "vitest";
import { subtreeOf, type CategoryNode } from "./budget";
import type { MonthKey } from "./dates";
import {
  budgetRows,
  comparisonFor,
  figuresFor,
  incomeUpToToday,
  monthlySeries,
  spendingByGroup,
  spentIn,
  type BudgetRecord,
  type PendingRow,
  type SpendingRow,
} from "./dashboard";
import { decimalToCents } from "./money";

const brl = decimalToCents;
const TODAY = "2026-10-09";
const CASA = "casa";
const DAN = "danillo";

const nodes: CategoryNode[] = [
  { id: "alimentacao", parentId: null },
  { id: "mercado", parentId: "alimentacao" },
  { id: "feira", parentId: "alimentacao" },
  { id: "moradia", parentId: null },
  { id: "aluguel", parentId: "moradia" },
  { id: "lazer", parentId: null },
];

const row = (r: Partial<SpendingRow> & Pick<SpendingRow, "month">): SpendingRow => ({
  walletId: CASA,
  categoryId: "mercado",
  payer: "dv",
  nature: "variable",
  upToToday: true,
  expense: 0n,
  income: 0n,
  firstAfterToday: null,
  ...r,
});

// Mercado da Casa em outubro (dia 9): DV 230,10 + NV 197,25 + CP 55,00 = 482,35
const rows: SpendingRow[] = [
  row({ month: "2026-10", payer: "dv", expense: brl("230.10") }),
  row({ month: "2026-10", payer: "nv", expense: brl("197.25") }),
  row({ month: "2026-10", payer: "compartilhado", expense: brl("55.00") }),
  // Os 6 meses anteriores do Mercado (abril a setembro), todos do DV para simplificar
  ...[
    ["2026-04", "1310.50"],
    ["2026-05", "1402.80"],
    ["2026-06", "1388.30"],
    ["2026-07", "1468.20"],
    ["2026-08", "1244.40"],
    ["2026-09", "1298.40"],
  ].map(([month, value]) => row({ month: month as string, expense: brl(value as string) })),
  // Aluguel agendado para o dia 10 (fixa, depois de hoje)
  row({
    month: "2026-10",
    categoryId: "aluguel",
    nature: "fixed",
    upToToday: false,
    expense: brl("2200"),
    firstAfterToday: "2026-10-10",
  }),
  // Lazer do Danillo, no ambiente pessoal dele
  row({ month: "2026-10", walletId: DAN, categoryId: "lazer", expense: brl("89.90") }),
  // Salário (receita, sem categoria de despesa)
  row({ month: "2026-10", walletId: DAN, categoryId: null, income: brl("8450") }),
];

const pending: PendingRow[] = [
  {
    month: "2026-10",
    date: "2026-10-20",
    walletId: CASA,
    categoryId: "aluguel",
    payer: "dv",
    expense: brl("100"),
  },
];

describe("figuresFor e as somas de um recorte", () => {
  it("Mercado da Casa: gasto até hoje, variável, nada agendado", () => {
    expect(
      figuresFor(rows, pending, "2026-10", {
        walletId: CASA,
        categories: new Set(["mercado"]),
      }),
    ).toEqual({
      spent: brl("482.35"),
      variableSpent: brl("482.35"),
      scheduled: 0n,
      pendingRecurrences: 0n,
    });
  });

  it("Pago por: só o que a pessoa pagou", () => {
    const f = figuresFor(rows, pending, "2026-10", {
      walletId: CASA,
      categories: new Set(["mercado"]),
      payer: "nv",
    });
    expect(f.spent).toBe(brl("197.25"));
  });

  it("o agendado e a recorrência pendente ficam separados do gasto", () => {
    const f = figuresFor(rows, pending, "2026-10", { categories: new Set(["aluguel"]) });
    expect(f).toEqual({
      spent: 0n,
      variableSpent: 0n,
      scheduled: brl("2200"),
      pendingRecurrences: brl("100"),
    });
  });

  it("mês fechado, entradas e comparação com 6 meses", () => {
    expect(spentIn(rows, "2026-09", { categories: new Set(["mercado"]) })).toBe(brl("1298.40"));
    expect(incomeUpToToday(rows, "2026-10", {})).toBe(brl("8450"));
    expect(comparisonFor(rows, "2026-10", { categories: new Set(["mercado"]) })).toMatchObject({
      lastMonth: brl("1298.40"),
      average6: brl("1352.10"),
      total6: brl("8112.60"),
    });
  });

  it("sem categoria é um recorte próprio", () => {
    expect(spentIn(rows, "2026-10", { categories: "none" })).toBe(0n);
  });
});

describe("spendingByGroup (Início)", () => {
  it("soma por categoria de primeiro nível, do maior previsto ao menor", () => {
    const groups = spendingByGroup({
      rows,
      pending,
      nodes,
      month: "2026-10",
      today: TODAY,
      slice: {},
    });
    expect(groups.map((g) => g.groupId)).toEqual(["moradia", "alimentacao", "lazer"]);
    const alimentacao = groups.find((g) => g.groupId === "alimentacao");
    expect(alimentacao?.projection.projected).toBe(brl("1661.43"));
    expect(alimentacao?.comparison.average6).toBe(brl("1352.10"));
    expect(groups.find((g) => g.groupId === "moradia")?.projection.projected).toBe(brl("2300"));
  });

  it("o ambiente filtra", () => {
    const groups = spendingByGroup({
      rows,
      pending,
      nodes,
      month: "2026-10",
      today: TODAY,
      slice: { walletId: DAN },
    });
    expect(groups.map((g) => g.groupId)).toEqual(["lazer"]);
  });
});

describe("budgetRows (Orçamento, por ambiente e por pessoa)", () => {
  const budgets: BudgetRecord[] = [
    {
      walletId: CASA,
      categoryId: "mercado",
      month: "2026-10",
      cents: brl("1400"),
      shares: [
        { payer: "dv", cents: brl("600") },
        { payer: "nv", cents: brl("500") },
        { payer: "compartilhado", cents: brl("300") },
      ],
    },
    { walletId: CASA, categoryId: "aluguel", month: "2026-10", cents: brl("2300"), shares: [] },
    { walletId: CASA, categoryId: "mercado", month: "2026-09", cents: brl("1400"), shares: [] },
  ];

  it("a linha do Mercado e as partes de cada pessoa (o exemplo do canvas)", () => {
    const [mercado] = budgetRows({
      budgets,
      rows,
      pending,
      nodes,
      month: "2026-10",
      today: TODAY,
      payer: null,
    });
    expect(mercado?.projection.projected).toBe(brl("1661.43"));
    expect(mercado?.status).toEqual({ kind: "over", by: brl("261.43") });
    expect(mercado?.parts.map((p) => [p.payer, p.projection.projected, p.status.kind])).toEqual([
      ["dv", brl("792.57"), "over"],
      ["nv", brl("679.42"), "over"],
      ["compartilhado", brl("189.44"), "within"],
    ]);
  });

  it("só fixa: 'Fixa, vence dia N' com o próximo vencimento", () => {
    const rowsOut = budgetRows({
      budgets,
      rows,
      pending,
      nodes,
      month: "2026-10",
      today: TODAY,
      payer: null,
    });
    const aluguel = rowsOut.find((r) => r.categoryId === "aluguel");
    // O agendado do dia 10 vem antes da recorrência do dia 20
    expect(aluguel).toMatchObject({ onlyFixed: true, nextDue: "2026-10-10", budget: brl("2300") });
    expect(aluguel?.status).toEqual({ kind: "within", left: 0n });
  });

  it("com Pago por: a parte da pessoa; categoria sem divisão fica sem orçado", () => {
    const rowsOut = budgetRows({
      budgets,
      rows,
      pending,
      nodes,
      month: "2026-10",
      today: TODAY,
      payer: "nv",
    });
    expect(rowsOut.find((r) => r.categoryId === "mercado")).toMatchObject({
      budget: brl("500"),
      fullBudget: brl("1400"),
      parts: [],
    });
    expect(rowsOut.find((r) => r.categoryId === "aluguel")?.budget).toBeNull();
    expect(rowsOut.find((r) => r.categoryId === "aluguel")?.status).toEqual({ kind: "none" });
  });
});

describe("monthlySeries (Evolução)", () => {
  it("meses fechados com o gasto; o de hoje com o previsto; o orçado do mês", () => {
    const series = monthlySeries({
      rows,
      pending,
      budgets: [
        { walletId: CASA, categoryId: "mercado", month: "2026-09", cents: brl("1400"), shares: [] },
        {
          walletId: CASA,
          categoryId: "mercado",
          month: "2026-10",
          cents: brl("1400"),
          shares: [{ payer: "nv", cents: brl("500") }],
        },
      ],
      nodes,
      months: ["2026-08", "2026-09", "2026-10"],
      today: TODAY,
      slice: { categories: new Set(["alimentacao", "mercado", "feira"]) },
    });
    expect(series).toEqual([
      { month: "2026-08", spent: brl("1244.40"), projected: brl("1244.40"), budget: null },
      { month: "2026-09", spent: brl("1298.40"), projected: brl("1298.40"), budget: brl("1400") },
      { month: "2026-10", spent: brl("482.35"), projected: brl("1661.43"), budget: brl("1400") },
    ]);
  });

  it("com Pago por, o orçado é a parte da pessoa", () => {
    const series = monthlySeries({
      rows,
      pending,
      budgets: [
        {
          walletId: CASA,
          categoryId: "mercado",
          month: "2026-10",
          cents: brl("1400"),
          shares: [{ payer: "nv", cents: brl("500") }],
        },
      ],
      nodes,
      months: ["2026-10"],
      today: TODAY,
      slice: { categories: new Set(["mercado"]), payer: "nv" },
    });
    expect(series[0]).toMatchObject({ spent: brl("197.25"), budget: brl("500") });
  });

  it("orçado que não cobre todo o gasto do recorte não aparece (sem falso 'acima')", () => {
    const budgets: BudgetRecord[] = [
      { walletId: CASA, categoryId: "mercado", month: "2026-10", cents: brl("1400"), shares: [] },
    ];
    const months: MonthKey[] = ["2026-10"];
    // Tudo que vejo: o Lazer do ambiente pessoal não tem orçado
    const all = monthlySeries({ rows, pending, budgets, nodes, months, today: TODAY, slice: {} });
    expect(all[0]?.budget).toBeNull();
    // Moradia: o aluguel não está orçado
    const housing = monthlySeries({
      rows,
      pending,
      budgets: [
        ...budgets,
        { walletId: CASA, categoryId: "moradia", month: "2026-09", cents: 1n, shares: [] },
      ],
      nodes,
      months,
      today: TODAY,
      slice: { categories: subtreeOf("moradia", nodes) },
    });
    expect(housing[0]?.budget).toBeNull();
    // O grupo inteiro coberto pelo orçado do Mercado (só há gasto no Mercado): aparece
    const food = monthlySeries({
      rows,
      pending,
      budgets,
      nodes,
      months,
      today: TODAY,
      slice: { categories: subtreeOf("alimentacao", nodes) },
    });
    expect(food[0]?.budget).toBe(brl("1400"));
    // Com Pago por e sem a parte da pessoa: não há orçado dela
    const dv = monthlySeries({
      rows,
      pending,
      budgets: [{ ...budgets[0]!, shares: [{ payer: "nv", cents: brl("1400") }] }],
      nodes,
      months,
      today: TODAY,
      slice: { categories: new Set(["mercado"]), payer: "dv" },
    });
    expect(dv[0]?.budget).toBeNull();
  });
});
