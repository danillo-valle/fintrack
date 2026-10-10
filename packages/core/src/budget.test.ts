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
  spendingNature,
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

describe("spendingNature", () => {
  it("recorrência é fixa; compra parcelada é parcela; o resto é variável", () => {
    expect(spendingNature({ recurrenceId: "r", installmentGroupId: null })).toBe("fixed");
    expect(spendingNature({ recurrenceId: null, installmentGroupId: "g" })).toBe("installment");
    expect(spendingNature({ recurrenceId: null, installmentGroupId: null })).toBe("variable");
  });
});

describe("projectMonth (decisão do M08: previsto + ritmo do variável)", () => {
  const none = { spent: 0n, variableSpent: 0n, scheduled: 0n, pendingRecurrences: 0n };

  it("o exemplo do canvas: Mercado, R$ 482,35 em 9 dias de 31 → R$ 1.661,43", () => {
    const p = projectMonth("2026-10", "2026-10-09", {
      ...none,
      spent: brl("482.35"),
      variableSpent: brl("482.35"),
    });
    expect(p.projected).toBe(brl("1661.43"));
    expect(p.pace).toBe(brl("1179.08"));
    expect(p).toMatchObject({ phase: "current", elapsedDays: 9, monthDays: 31 });
  });

  it("fixa e parcela entram pelo valor; só o variável é extrapolado", () => {
    const p = projectMonth("2026-10", "2026-10-09", {
      spent: brl("129.90"), // internet já paga (fixa)
      variableSpent: 0n,
      scheduled: brl("2200"), // aluguel agendado para o dia 10
      pendingRecurrences: brl("310"), // luz e água ainda não lançadas
    });
    expect(p.projected).toBe(brl("2639.90"));
    expect(p.pace).toBe(0n);
  });

  it("mês fechado: o previsto é o gasto (nada agendado conta)", () => {
    const p = projectMonth("2026-09", "2026-10-09", {
      spent: brl("1298.40"),
      variableSpent: brl("1298.40"),
      scheduled: brl("99"),
      pendingRecurrences: brl("99"),
    });
    expect(p).toMatchObject({ phase: "closed", spent: brl("1298.40"), projected: brl("1298.40") });
  });

  it("mês futuro: só o que já está previsto", () => {
    const p = projectMonth("2026-11", "2026-10-09", {
      ...none,
      scheduled: brl("1284.30"),
      pendingRecurrences: brl("2869.60"),
    });
    expect(p).toMatchObject({ phase: "future", spent: 0n, projected: brl("4153.90") });
  });

  it("no último dia, o previsto é o gasto mais o agendado (não há dias para o ritmo)", () => {
    const p = projectMonth("2026-10", "2026-10-31", {
      ...none,
      spent: brl("900"),
      variableSpent: brl("900"),
    });
    expect(p.projected).toBe(brl("900"));
  });

  it("propriedade: o previsto nunca é menor que o gasto até hoje", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 31 }),
        fc.bigInt(0n, 10n ** 9n),
        fc.bigInt(0n, 10n ** 9n),
        fc.bigInt(0n, 10n ** 9n),
        (day, fixedPart, variable, scheduled) => {
          const today = `2026-10-${String(day).padStart(2, "0")}`;
          const p = projectMonth("2026-10", today, {
            spent: fixedPart + variable,
            variableSpent: variable,
            scheduled,
            pendingRecurrences: 0n,
          });
          return p.projected >= p.spent;
        },
      ),
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
