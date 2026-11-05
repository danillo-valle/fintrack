import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  averageCents,
  budgetLevelConflict,
  budgetStatus,
  budgetsToCopy,
  categoryGroupOf,
  checkShares,
  divRound,
  monthPhase,
  monthsBefore,
  monthsEndingAt,
  monthsStartingAt,
  percentVersus,
  projectMonth,
  ACCOUNTS_WINDOW,
  windowPace,
  natureIsChoosable,
  NO_FIGURES,
  spendingNature,
  storedNature,
  natureView,
  subtreeOf,
  type CategoryNode,
} from "./budget";
import { decimalToCents } from "./money";

const brl = decimalToCents;

describe("divRound e averageCents", () => {
  it("arredonda metade para longe do zero", () => {
    expect(divRound(5n, 2n)).toBe(3n);
    expect(divRound(-5n, 2n)).toBe(-3n);
    expect(divRound(4n, 3n)).toBe(1n);
    expect(divRound(14953_15n, 9n)).toBe(1661_46n); // 14953,15 / 9 = 1661,4611...
    expect(() => divRound(1n, 0n)).toThrow();
  });

  it("propriedade: |divRound(n, d) * d - n| <= d/2", () => {
    fc.assert(
      fc.property(fc.bigInt(-(10n ** 12n), 10n ** 12n), fc.bigInt(1n, 10n ** 6n), (n, d) => {
        const q = divRound(n, d);
        const diff = q * d - n;
        return (diff < 0n ? -diff : diff) * 2n <= d;
      }),
    );
  });

  it("média ao centavo; lista vazia é zero", () => {
    expect(averageCents([])).toBe(0n);
    expect(
      averageCents([
        brl("1310.50"),
        brl("1402.80"),
        brl("1388.30"),
        brl("1468.20"),
        brl("1244.40"),
        brl("1298.40"),
      ]),
    ).toBe(brl("1352.10"));
  });

  it("percentual contra a base, inteiro; base zero não compara", () => {
    expect(percentVersus(brl("1661.43"), brl("1352.10"))).toBe(23n);
    expect(percentVersus(brl("120.56"), brl("131.60"))).toBe(-8n);
    expect(percentVersus(brl("2200"), brl("2200"))).toBe(0n);
    expect(percentVersus(100n, 0n)).toBeNull();
  });
});

describe("meses", () => {
  it("fechado, em andamento ou futuro em relação a hoje", () => {
    expect(monthPhase("2026-09", "2026-10-09")).toBe("closed");
    expect(monthPhase("2026-10", "2026-10-09")).toBe("current");
    expect(monthPhase("2026-11", "2026-10-09")).toBe("future");
  });

  it("os 6 meses antes, os últimos 12 e os próximos 6", () => {
    expect(monthsBefore("2026-10", 6)).toEqual([
      "2026-04",
      "2026-05",
      "2026-06",
      "2026-07",
      "2026-08",
      "2026-09",
    ]);
    expect(monthsEndingAt("2026-10", 12)[0]).toBe("2025-11");
    expect(monthsEndingAt("2026-10", 12).at(-1)).toBe("2026-10");
    expect(monthsStartingAt("2026-10", 6)).toEqual([
      "2026-10",
      "2026-11",
      "2026-12",
      "2027-01",
      "2027-02",
      "2027-03",
    ]);
  });
});

describe("spendingNature (ADR-026)", () => {
  const base = { recurrenceId: null, installmentGroupId: null } as const;

  it("recorrência é fixa, parcelada é parcela, o resto é variável", () => {
    expect(spendingNature({ ...base, recurrenceId: "r" })).toBe("fixed");
    expect(spendingNature({ ...base, installmentGroupId: "g" })).toBe("installment");
    expect(spendingNature(base)).toBe("variable");
  });

  it("a parcela do banco é parcela, e nenhuma marca muda isso", () => {
    expect(spendingNature({ ...base, providerInstallmentCount: 6 })).toBe("installment");
    expect(
      spendingNature({
        ...base,
        providerInstallmentCount: 6,
        nature: "FIXED",
        categoryNature: "FIXED",
      }),
    ).toBe("installment");
    expect(natureIsChoosable({ ...base, installmentGroupId: "g" })).toBe(false);
    expect(natureIsChoosable({ ...base, providerInstallmentCount: 3 })).toBe(false);
    expect(natureIsChoosable(base)).toBe(true);
  });

  it("a marca da compra vale mais que a recorrência e que a categoria", () => {
    expect(spendingNature({ ...base, nature: "VARIABLE", recurrenceId: "r" })).toBe("variable");
    expect(spendingNature({ ...base, nature: "FIXED", categoryNature: "VARIABLE" })).toBe("fixed");
    expect(spendingNature({ ...base, nature: "VARIABLE", categoryNature: "FIXED" })).toBe(
      "variable",
    );
  });

  it("sem marca: a recorrência, depois o padrão da categoria; sem categoria, variável", () => {
    expect(spendingNature({ ...base, recurrenceId: "r", categoryNature: "VARIABLE" })).toBe(
      "fixed",
    );
    expect(spendingNature({ ...base, categoryNature: "FIXED" })).toBe("fixed");
    expect(spendingNature({ ...base, categoryNature: "VARIABLE" })).toBe("variable");
    expect(spendingNature({ ...base, categoryNature: null })).toBe("variable");
  });
});

/** Um valor por tipo: fixa, parcela, variável. */
const n = (fixed = 0n, installment = 0n, variable = 0n) => ({ fixed, installment, variable });

describe("projectMonth (decisão do M08: previsto + ritmo do variável)", () => {
  const none = NO_FIGURES;
  /** Gasto variável nas contas (a janela do mês) */
  const inAccounts = (cents: bigint) => new Map([[ACCOUNTS_WINDOW, cents]]);

  it("o exemplo do canvas: Mercado, R$ 482,35 em 9 dias de 31 → R$ 1.661,43", () => {
    const p = projectMonth("2026-10", "2026-10-09", {
      ...none,
      spent: n(0n, 0n, brl("482.35")),
      variableByWindow: inAccounts(brl("482.35")),
    });
    expect(p.projected).toBe(brl("1661.43"));
    expect(p.pace).toBe(brl("1179.08"));
    expect(p.parts).toEqual(n(0n, 0n, brl("1661.43")));
    expect(p).toMatchObject({ phase: "current", elapsedDays: 9, monthDays: 31 });
  });

  it("fixa e parcela entram pelo valor; só o variável é extrapolado", () => {
    const p = projectMonth("2026-10", "2026-10-09", {
      ...none,
      spent: n(brl("129.90")), // internet já paga (fixa)
      scheduled: n(brl("2200"), brl("150")), // aluguel e a parcela agendados
      pending: n(brl("310")), // luz e água ainda não lançadas
    });
    expect(p.projected).toBe(brl("2789.90"));
    expect(p.parts).toEqual(n(brl("2639.90"), brl("150"), 0n));
    expect(p.pace).toBe(0n);
  });

  it("a assinatura que já chegou no dia 2 não se multiplica pelo ritmo (ADR-026)", () => {
    // R$ 55,90 de Netflix (fixa) e R$ 300 de mercado (variável) em 3 dias de novembro
    const p = projectMonth("2026-11", "2026-11-03", {
      ...none,
      spent: n(brl("55.90"), 0n, brl("300")),
      variableByWindow: inAccounts(brl("300")),
    });
    expect(p.parts.fixed).toBe(brl("55.90"));
    expect(p.parts.variable).toBe(brl("3000")); // 300 + 300 × 27 ÷ 3
    expect(p.projected).toBe(brl("3055.90"));
  });

  it("mês fechado: o previsto é o gasto (nada agendado conta)", () => {
    const p = projectMonth("2026-09", "2026-10-09", {
      spent: n(0n, 0n, brl("1298.40")),
      variableByWindow: inAccounts(brl("1298.40")),
      scheduled: n(brl("99")),
      pending: n(brl("99")),
    });
    expect(p).toMatchObject({ phase: "closed", spent: brl("1298.40"), projected: brl("1298.40") });
    expect(p.parts).toEqual(n(0n, 0n, brl("1298.40")));
  });

  it("mês futuro: só o que já está previsto", () => {
    const p = projectMonth("2026-11", "2026-10-09", {
      ...none,
      scheduled: n(0n, brl("1284.30")),
      pending: n(brl("2869.60")),
    });
    expect(p).toMatchObject({ phase: "future", spent: 0n, projected: brl("4153.90") });
  });

  it("no último dia, o previsto é o gasto mais o agendado (não há dias para o ritmo)", () => {
    const p = projectMonth("2026-10", "2026-10-31", {
      ...none,
      spent: n(0n, 0n, brl("900")),
      variableByWindow: inAccounts(brl("900")),
    });
    expect(p.projected).toBe(brl("900"));
  });

  it("propriedade: o previsto nunca é menor que o gasto, e as partes somam o previsto", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 31 }),
        fc.bigInt(0n, 10n ** 9n),
        fc.bigInt(0n, 10n ** 9n),
        fc.bigInt(0n, 10n ** 9n),
        fc.bigInt(0n, 10n ** 9n),
        (day, fixedPart, variable, scheduled, pending) => {
          const today = `2026-10-${String(day).padStart(2, "0")}`;
          const p = projectMonth("2026-10", today, {
            spent: n(fixedPart, 0n, variable),
            variableByWindow: inAccounts(variable),
            scheduled: n(0n, scheduled),
            pending: n(pending, pending),
          });
          return (
            p.projected >= p.spent &&
            p.parts.fixed + p.parts.installment + p.parts.variable === p.projected
          );
        },
      ),
    );
  });
});

describe("o ritmo por janela (M13.3a, ADR-025)", () => {
  const none = NO_FIGURES;

  it("a fatura que vence no mês e já fechou não cresce: ritmo zero", () => {
    // Fatura do Master que vence 09/11: compras de 03/10 a 02/11. Hoje, 03/11, ela já fechou
    const fatura = { start: "2026-10-03", end: "2026-11-02" };
    expect(windowPace(brl("1263.40"), fatura, "2026-11-03")).toBe(0n);
    const p = projectMonth(
      "2026-11",
      "2026-11-03",
      {
        ...none,
        spent: n(brl("1055"), 0n, brl("1263.40")),
        variableByWindow: new Map([["fatura-nov", brl("1263.40")]]),
      },
      new Map([["fatura-nov", fatura]]),
    );
    expect(p.pace).toBe(0n);
    expect(p.projected).toBe(brl("2318.40"));
  });

  it("nas contas, o mês inteiro: o mesmo número do M08", () => {
    // R$ 501,77 em 3 dias de novembro → R$ 4.515,93 nos 27 que faltam
    const p = projectMonth("2026-11", "2026-11-03", {
      ...none,
      spent: n(0n, 0n, brl("501.77")),
      variableByWindow: new Map([[ACCOUNTS_WINDOW, brl("501.77")]]),
    });
    expect(p.pace).toBe(brl("4515.93"));
  });

  it("fatura aberta que vence no mês: o ritmo só até o fechamento dela", () => {
    // Fecha 10/11 e vence 17/11: compras de 10/10 a 09/11. Hoje, 03/11: 25 dias passados, 6 faltam
    const fatura = { start: "2026-10-10", end: "2026-11-09" };
    expect(windowPace(brl("250"), fatura, "2026-11-03")).toBe(brl("60"));
  });

  it("mês futuro: a fatura dele que já está aberta tem ritmo, as contas não", () => {
    // Fecha 25 e vence 5: a fatura de dezembro (compras de 25/10 a 24/11) está aberta hoje
    const dezembro = { start: "2026-10-25", end: "2026-11-24" };
    const p = projectMonth(
      "2026-12",
      "2026-11-03",
      {
        ...none,
        spent: n(0n, 0n, brl("100")),
        variableByWindow: new Map([["fatura-dez", brl("100")]]),
      },
      new Map([["fatura-dez", dezembro]]),
    );
    // 10 dias passados (25/10 a 03/11), 21 faltam: 100 × 21 ÷ 10 = 210
    expect(p).toMatchObject({ phase: "future", spent: brl("100"), pace: brl("210") });
    expect(p.projected).toBe(brl("310"));
  });

  it("janela que ainda não começou: sem ritmo", () => {
    expect(windowPace(brl("100"), { start: "2026-11-04", end: "2026-12-03" }, "2026-11-03")).toBe(
      0n,
    );
  });
});

describe("budgetStatus", () => {
  it("acima, dentro ou sem orçado", () => {
    expect(budgetStatus(brl("1661.43"), brl("1400"))).toEqual({ kind: "over", by: brl("261.43") });
    expect(budgetStatus(brl("439.90"), brl("480"))).toEqual({ kind: "within", left: brl("40.10") });
    expect(budgetStatus(brl("2200"), brl("2200"))).toEqual({ kind: "within", left: 0n });
    expect(budgetStatus(brl("10"), null)).toEqual({ kind: "none" });
  });
});

const tree: CategoryNode[] = [
  { id: "alimentacao", parentId: null },
  { id: "mercado", parentId: "alimentacao" },
  { id: "feira", parentId: "alimentacao" },
  { id: "hortifruti", parentId: "feira" }, // neta (o banco aceita; a tela cria só filhas)
  { id: "moradia", parentId: null },
  { id: "aluguel", parentId: "moradia" },
];
const parents = new Map(tree.map((n) => [n.id, n.parentId] as const));

describe("árvore de categorias", () => {
  it("o grupo é a categoria de primeiro nível", () => {
    expect(categoryGroupOf("mercado", parents)).toBe("alimentacao");
    expect(categoryGroupOf("hortifruti", parents)).toBe("alimentacao");
    expect(categoryGroupOf("moradia", parents)).toBe("moradia");
    expect(categoryGroupOf("desconhecida", parents)).toBe("desconhecida");
  });

  it("uma volta na árvore não trava", () => {
    const loop = new Map([
      ["a", "b"],
      ["b", "a"],
    ]);
    expect(["a", "b"]).toContain(categoryGroupOf("a", loop));
  });

  it("a categoria e todas as de baixo", () => {
    expect([...subtreeOf("alimentacao", tree)].sort()).toEqual([
      "alimentacao",
      "feira",
      "hortifruti",
      "mercado",
    ]);
    expect([...subtreeOf("aluguel", tree)]).toEqual(["aluguel"]);
  });

  it("regra do nível: não orçar uma categoria e a de cima (ou a de baixo) juntas", () => {
    expect(budgetLevelConflict("mercado", ["alimentacao"], tree)).toBe("alimentacao");
    expect(budgetLevelConflict("alimentacao", ["hortifruti"], tree)).toBe("hortifruti");
    expect(budgetLevelConflict("mercado", ["feira", "aluguel", "mercado"], tree)).toBeNull();
  });
});

describe("checkShares (orçado por pessoa)", () => {
  const share = (payer: string, value: string) => ({ payer, cents: brl(value) });

  it("a soma das partes é o orçado da categoria", () => {
    expect(
      checkShares(brl("1400"), [
        share("dan", "600"),
        share("nel", "500"),
        share("compartilhado", "300"),
      ]),
    ).toBeNull();
    expect(checkShares(brl("1400"), [share("dan", "600"), share("nel", "500")])).toBe(
      "SHARES_SUM_MISMATCH",
    );
  });

  it("sem divisão sempre vale; pessoa repetida e parte negativa não", () => {
    expect(checkShares(brl("1400"), [])).toBeNull();
    expect(checkShares(brl("2"), [share("dan", "1"), share("dan", "1")])).toBe("SHARES_DUPLICATED");
    expect(checkShares(brl("1"), [share("dan", "2"), share("nel", "-1")])).toBe("SHARES_NEGATIVE");
  });
});

describe("budgetsToCopy (copiar do mês anterior)", () => {
  const line = (categoryId: string, value: string) => ({
    categoryId,
    cents: brl(value),
    shares: [],
  });

  it("preenche só o que falta; nunca sobrescreve", () => {
    const result = budgetsToCopy(
      [line("mercado", "1400"), line("aluguel", "2200"), line("feira", "250")],
      [{ categoryId: "aluguel" }],
      tree,
    );
    expect(result.copy.map((c) => c.categoryId)).toEqual(["mercado", "feira"]);
    expect(result.kept).toBe(1);
  });

  it("pula a que quebraria a regra do nível", () => {
    const result = budgetsToCopy([line("mercado", "1400")], [{ categoryId: "alimentacao" }], tree);
    expect(result).toEqual({ copy: [], kept: 1 });
  });

  it("copiar duas vezes não copia nada na segunda", () => {
    const previous = [line("mercado", "1400"), line("aluguel", "2200")];
    const first = budgetsToCopy(previous, [], tree);
    const second = budgetsToCopy(previous, first.copy, tree);
    expect(second.copy).toEqual([]);
    expect(second.kept).toBe(2);
  });
});

describe("a marca que se grava (ADR-026)", () => {
  const base = { expense: true, installment: false, transfer: false, nature: "FIXED" as const };
  it("só numa saída avulsa", () => {
    expect(storedNature(base)).toBe("FIXED");
    expect(storedNature({ ...base, nature: undefined })).toBeNull();
    expect(storedNature({ ...base, expense: false })).toBeNull();
    expect(storedNature({ ...base, installment: true })).toBeNull();
    expect(storedNature({ ...base, transfer: true })).toBeNull();
  });
});

describe("o tipo para a tela (ADR-026)", () => {
  const base = { recurrenceId: null, installmentGroupId: null, expense: true, transfer: false };
  it("só numa saída que não é transferência; a parcela não se escolhe", () => {
    expect(natureView({ ...base, categoryNature: "FIXED" })).toEqual({
      kind: "fixed",
      choosable: true,
      categoryNature: "FIXED",
    });
    expect(natureView({ ...base, providerInstallmentCount: 6 })).toMatchObject({
      kind: "installment",
      choosable: false,
    });
    expect(natureView({ ...base, expense: false })).toBeNull();
    expect(natureView({ ...base, transfer: true })).toBeNull();
  });
});
