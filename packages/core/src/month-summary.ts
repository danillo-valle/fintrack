// O resumo do mês (M10.3, linha F.3 do canvas, decisões de 20/10/2026): três observações
// calculadas por regras, sem IA, cada uma com os números que levam aos lançamentos que a formam.
//
//   1. OVER_BUDGET    o previsto de uma categoria orçada passa do orçado naquele ambiente
//                     (no mês fechado, o gasto de verdade). Peso: quanto passa.
//   2. ABOVE_USUAL    o gasto de um grupo de categorias já passa da média dos 6 meses anteriores
//                     em mais de 20 % e em pelo menos R$ 50, com gasto em 3 desses 6 meses ou mais.
//                     Peso: a diferença para a média.
//   3. NEW_RECURRING  uma conta fixa ou assinatura (despesa) que começou no mês. Peso: 12 meses.
//
// Entram as três de maior peso, no máximo uma por grupo de categoria. Do dia 1 ao dia 5, o resumo é
// o do mês anterior, fechado ("o de outubro aparece no dia 6"). Calculado na hora, com as mesmas
// somas do Início (sem os recebidos que ainda esperam revisão).
import {
  budgetRows,
  comparisonFor,
  spendingByGroup,
  spentIn,
  type BudgetRecord,
  type PendingRow,
  type Slice,
  type SpendingRow,
} from "./dashboard";
import {
  categoryGroupOf,
  monthsBefore,
  percentVersus,
  subtreeOf,
  type CategoryNode,
} from "./budget";
import { addMonthsToKey, monthOf, parseCivilDate, type CivilDate, type MonthKey } from "./dates";
import type { Cents } from "./money";

export const SUMMARY_LIMIT = 3;
/** Até este dia do mês, o resumo é o do mês anterior, fechado. */
export const SUMMARY_CLOSED_UNTIL_DAY = 5;
/** "Acima do costume": mais de 20 % acima da média... */
export const ABOVE_USUAL_PERCENT = 20n;
/** ... e pelo menos R$ 50,00 acima... */
export const ABOVE_USUAL_MIN_CENTS = 5_000n;
/** ... com gasto em pelo menos 3 dos 6 meses da média (senão a média não diz nada). */
export const ABOVE_USUAL_MIN_MONTHS = 3;

export type SummaryMode = "current" | "closed";
export type ObservationKind = "OVER_BUDGET" | "ABOVE_USUAL" | "NEW_RECURRING";

/** De qual mês é o resumo hoje, e se ele já está fechado. */
export function summaryPeriod(today: CivilDate): { month: MonthKey; mode: SummaryMode } {
  const current = monthOf(today);
  return parseCivilDate(today).day <= SUMMARY_CLOSED_UNTIL_DAY
    ? { month: addMonthsToKey(current, -1), mode: "closed" }
    : { month: current, mode: "current" };
}

/** Uma conta fixa ou assinatura do escopo que começou no mês do resumo. */
export type NewRecurrence = {
  id: string;
  kind: "FIXED_BILL" | "SUBSCRIPTION";
  walletId: string;
  categoryId: string | null;
  description: string;
  /** Positivo: quanto sai por mês */
  monthly: Cents;
  startsOn: CivilDate;
};

export type Observation =
  | {
      kind: "OVER_BUDGET";
      weight: Cents;
      walletId: string;
      categoryId: string;
      /** O previsto (mês corrente) ou o gasto (mês fechado) */
      amount: Cents;
      budget: Cents;
      by: Cents;
    }
  | {
      kind: "ABOVE_USUAL";
      weight: Cents;
      /** O grupo (categoria de primeiro nível) */
      categoryId: string;
      /** Até hoje (mês corrente) ou no mês inteiro (fechado) */
      spent: Cents;
      average: Cents;
      /** Quanto acima da média, em pontos percentuais (o mesmo arredondamento do painel) */
      percent: bigint;
      months6: MonthKey[];
    }
  | {
      kind: "NEW_RECURRING";
      weight: Cents;
      recurrence: NewRecurrence;
      /** 12 × o mensal */
      yearly: Cents;
    };

export type MonthSummary = {
  month: MonthKey;
  mode: SummaryMode;
  observations: Observation[];
  /** Os tipos que não tiveram nenhum candidato (a frase "nenhum orçado deve estourar...") */
  absent: ObservationKind[];
};

const ORDER: Record<ObservationKind, number> = { OVER_BUDGET: 0, ABOVE_USUAL: 1, NEW_RECURRING: 2 };

/** As observações do mês, já escolhidas e na ordem da tela. */
export function monthSummary(input: {
  month: MonthKey;
  mode: SummaryMode;
  today: CivilDate;
  rows: readonly SpendingRow[];
  pending: readonly PendingRow[];
  budgets: readonly BudgetRecord[];
  nodes: readonly CategoryNode[];
  recurrences: readonly NewRecurrence[];
}): MonthSummary {
  const parents = new Map(input.nodes.map((n) => [n.id, n.parentId] as const));
  const groupOf = (categoryId: string) => categoryGroupOf(categoryId, parents);

  const over: Observation[] = budgetRows({
    budgets: input.budgets,
    rows: input.rows,
    pending: input.pending,
    nodes: input.nodes,
    month: input.month,
    today: input.today,
    payer: null,
  }).flatMap((r) =>
    r.status.kind === "over" && r.budget !== null
      ? [
          {
            kind: "OVER_BUDGET" as const,
            weight: r.status.by,
            walletId: r.walletId,
            categoryId: r.categoryId,
            amount: r.projection.projected,
            budget: r.budget,
            by: r.status.by,
          },
        ]
      : [],
  );

  const above: Observation[] = spendingByGroup({
    rows: input.rows,
    pending: input.pending,
    nodes: input.nodes,
    month: input.month,
    today: input.today,
    slice: {},
  }).flatMap((g) => {
    if (g.groupId === null) return []; // "Sem categoria" não tem costume
    const slice: Slice = { categories: subtreeOf(g.groupId, input.nodes) };
    const months6 = monthsBefore(input.month, 6);
    const withSpending = months6.filter((m) => spentIn(input.rows, m, slice) > 0n).length;
    const { average6 } = comparisonFor(input.rows, input.month, slice);
    const spent = g.projection.spent;
    const diff = spent - average6;
    if (
      withSpending < ABOVE_USUAL_MIN_MONTHS ||
      average6 <= 0n ||
      diff < ABOVE_USUAL_MIN_CENTS ||
      diff * 100n <= average6 * ABOVE_USUAL_PERCENT
    ) {
      return [];
    }
    return [
      {
        kind: "ABOVE_USUAL" as const,
        weight: diff,
        categoryId: g.groupId,
        spent,
        average: average6,
        percent: percentVersus(spent, average6) ?? 0n,
        months6,
      },
    ];
  });

  const recurring: Observation[] = input.recurrences
    .filter((r) => monthOf(r.startsOn) === input.month && r.monthly > 0n)
    .map((r) => ({
      kind: "NEW_RECURRING" as const,
      weight: r.monthly * 12n,
      recurrence: r,
      yearly: r.monthly * 12n,
    }));

  const keyOf = (o: Observation) =>
    o.kind === "NEW_RECURRING"
      ? o.recurrence.categoryId
        ? groupOf(o.recurrence.categoryId)
        : `recorrencia:${o.recurrence.id}`
      : groupOf(o.categoryId);

  const ranked = [...over, ...above, ...recurring].toSorted((a, b) =>
    a.weight === b.weight ? ORDER[a.kind] - ORDER[b.kind] : a.weight > b.weight ? -1 : 1,
  );
  const used = new Set<string>();
  const observations: Observation[] = [];
  for (const o of ranked) {
    if (observations.length === SUMMARY_LIMIT) break;
    const key = keyOf(o);
    if (used.has(key)) continue;
    used.add(key);
    observations.push(o);
  }
  const absent = (["OVER_BUDGET", "ABOVE_USUAL", "NEW_RECURRING"] as const).filter(
    (kind) => ![...over, ...above, ...recurring].some((o) => o.kind === kind),
  );
  return { month: input.month, mode: input.mode, observations, absent };
}
