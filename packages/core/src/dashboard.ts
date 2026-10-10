// Painel e orçamento (M08): de linhas somadas pelo banco aos números de cada tela.
//
// O banco devolve o gasto já somado por mês, ambiente, categoria, quem pagou e natureza
// (SpendingRow). Daqui sai tudo o que as telas mostram, sempre pelos mesmos recortes que a lista
// de lançamentos entende (ambiente, categoria com as de baixo, Pago por, período). É isso que
// garante que todo número leva aos lançamentos que o compõem e que o total bate com a lista.
import {
  addFigures,
  averageCents,
  budgetStatus,
  categoryGroupOf,
  monthsBefore,
  NO_FIGURES,
  projectMonth,
  subtreeOf,
  type BudgetShare,
  type BudgetStatus,
  type CategoryNode,
  type MonthFigures,
  type Projection,
  type SpendingNature,
} from "./budget";
import { monthOf, type CivilDate, type MonthKey } from "./dates";
import { sumCents, type Cents } from "./money";

/** O gasto somado pelo banco para um recorte. `expense` e `income` são positivos. */
export type SpendingRow = {
  month: MonthKey;
  walletId: string;
  categoryId: string | null;
  /** "Pago por": o id da pessoa, "compartilhado" ou null (sem titular nem portador) */
  payer: string | null;
  nature: SpendingNature;
  /** true: do dia 1 até hoje; false: depois de hoje (agendado) */
  upToToday: boolean;
  /** Saídas (soma dos valores negativos, sem transferências), em positivo */
  expense: Cents;
  /** Entradas (soma dos positivos, sem transferências) */
  income: Cents;
  /** Agendado (upToToday false): a data da primeira saída depois de hoje, para "vence dia 10" */
  firstAfterToday: CivilDate | null;
};

/** Uma recorrência de despesa ainda não lançada no mês, já no recorte dela. */
export type PendingRow = {
  month: MonthKey;
  date: CivilDate;
  walletId: string;
  categoryId: string | null;
  payer: string | null;
  /** Positivo */
  expense: Cents;
};

/** Um recorte: os filtros que a lista de lançamentos também entende. null = sem filtro. */
export type Slice = {
  walletId?: string | null;
  /** Conjunto de categorias (a categoria escolhida e as de baixo); "none" = sem categoria */
  categories?: ReadonlySet<string> | "none" | null;
  payer?: string | null;
};

function matches(
  row: { walletId: string; categoryId: string | null; payer: string | null },
  s: Slice,
) {
  if (s.walletId && row.walletId !== s.walletId) return false;
  if (s.payer && row.payer !== s.payer) return false;
  if (s.categories === "none") return row.categoryId === null;
  if (s.categories && (row.categoryId === null || !s.categories.has(row.categoryId))) return false;
  return true;
}

/** O que se sabe de um mês num recorte (para projectMonth). */
export function figuresFor(
  rows: readonly SpendingRow[],
  pending: readonly PendingRow[],
  month: MonthKey,
  slice: Slice,
): MonthFigures {
  let f = NO_FIGURES;
  for (const r of rows) {
    if (r.month !== month || !matches(r, slice)) continue;
    f = addFigures(f, {
      spent: r.upToToday ? r.expense : 0n,
      variableSpent: r.upToToday && r.nature === "variable" ? r.expense : 0n,
      scheduled: r.upToToday ? 0n : r.expense,
      pendingRecurrences: 0n,
    });
  }
  const pend = sumCents(
    pending.filter((p) => p.month === month && matches(p, slice)).map((p) => p.expense),
  );
  return { ...f, pendingRecurrences: f.pendingRecurrences + pend };
}

/** Gasto de um mês fechado num recorte (tudo o que aconteceu no mês). */
export function spentIn(rows: readonly SpendingRow[], month: MonthKey, slice: Slice): Cents {
  return sumCents(rows.filter((r) => r.month === month && matches(r, slice)).map((r) => r.expense));
}

/** Entradas de um mês até hoje, num recorte (para o resumo do Início). */
export function incomeUpToToday(
  rows: readonly SpendingRow[],
  month: MonthKey,
  slice: Slice,
): Cents {
  return sumCents(
    rows.filter((r) => r.month === month && r.upToToday && matches(r, slice)).map((r) => r.income),
  );
}

/** As comparações de um recorte: o mês passado e a média dos 6 meses fechados antes do mês. */
export type Comparison = {
  lastMonth: Cents;
  average6: Cents;
  /** A soma exata dos 6 meses (a média é arredondada; a lista do período soma isto) */
  total6: Cents;
  months6: MonthKey[];
};

export function comparisonFor(
  rows: readonly SpendingRow[],
  month: MonthKey,
  slice: Slice,
): Comparison {
  const months6 = monthsBefore(month, 6);
  const values = months6.map((m) => spentIn(rows, m, slice));
  return {
    lastMonth: values.at(-1) ?? 0n,
    average6: averageCents(values),
    total6: sumCents(values),
    months6,
  };
}

// ── Gasto por categoria (Início) ──────────────────────────────────────────────

export type GroupSpending = {
  /** A categoria de primeiro nível, ou null para "Sem categoria" */
  groupId: string | null;
  projection: Projection;
  comparison: Comparison;
};

/**
 * O gasto do mês por grupo (categoria de primeiro nível), do maior previsto para o menor. Só
 * despesas: categorias de receita não entram. Grupos sem gasto no mês nem nos 6 anteriores
 * ficam de fora.
 */
export function spendingByGroup(input: {
  rows: readonly SpendingRow[];
  pending: readonly PendingRow[];
  nodes: readonly CategoryNode[];
  month: MonthKey;
  today: CivilDate;
  slice: Slice;
}): GroupSpending[] {
  const parents = new Map(input.nodes.map((n) => [n.id, n.parentId] as const));
  const groups = new Set<string | null>();
  for (const r of [...input.rows, ...input.pending]) {
    if (r.expense === 0n || !matches(r, input.slice)) continue;
    groups.add(r.categoryId === null ? null : categoryGroupOf(r.categoryId, parents));
  }
  const result: GroupSpending[] = [];
  for (const groupId of groups) {
    const slice: Slice = {
      ...input.slice,
      categories: groupId === null ? "none" : subtreeOf(groupId, input.nodes),
    };
    const projection = projectMonth(
      input.month,
      input.today,
      figuresFor(input.rows, input.pending, input.month, slice),
    );
    const comparison = comparisonFor(input.rows, input.month, slice);
    if (projection.projected === 0n && comparison.average6 === 0n && comparison.lastMonth === 0n)
      continue;
    result.push({ groupId, projection, comparison });
  }
  return result.toSorted((a, b) =>
    a.projection.projected === b.projection.projected
      ? 0
      : a.projection.projected > b.projection.projected
        ? -1
        : 1,
  );
}

// ── Orçado × realizado (Orçamento) ────────────────────────────────────────────

/** Um orçado gravado: ambiente, categoria, mês, valor e a divisão (se houver). */
export type BudgetRecord = {
  walletId: string;
  categoryId: string;
  month: MonthKey;
  cents: Cents;
  shares: readonly BudgetShare[];
};

export type BudgetRowPart = {
  payer: string;
  budget: Cents;
  projection: Projection;
  comparison: Comparison;
  status: BudgetStatus;
};

export type BudgetRow = {
  walletId: string;
  categoryId: string;
  /** O orçado da linha. Com "Pago por" escolhido: a parte da pessoa (null se não está dividido) */
  budget: Cents | null;
  /** O orçado inteiro da categoria (sem filtro) */
  fullBudget: Cents;
  projection: Projection;
  comparison: Comparison;
  status: BudgetStatus;
  /** Tudo o que falta no mês é fixo (o variável é zero): a tela diz "Fixa, vence dia N" */
  onlyFixed: boolean;
  /** O próximo vencimento previsto (fixa agendada ou recorrência pendente), se houver */
  nextDue: CivilDate | null;
  /** A divisão por quem paga (vazia = não dividido) */
  parts: BudgetRowPart[];
};

/**
 * As linhas do orçamento de um mês. Cada linha soma a categoria orçada e as de baixo dela, no
 * ambiente do orçado; com "Pago por", só o que aquela pessoa pagou (e a parte dela no orçado).
 */
export function budgetRows(input: {
  budgets: readonly BudgetRecord[];
  rows: readonly SpendingRow[];
  pending: readonly PendingRow[];
  nodes: readonly CategoryNode[];
  month: MonthKey;
  today: CivilDate;
  payer: string | null;
}): BudgetRow[] {
  return input.budgets
    .filter((b) => b.month === input.month)
    .map((b) => {
      const categories = subtreeOf(b.categoryId, input.nodes);
      const base: Slice = { walletId: b.walletId, categories };
      const slice: Slice = { ...base, payer: input.payer };
      const figures = figuresFor(input.rows, input.pending, input.month, slice);
      const projection = projectMonth(input.month, input.today, figures);
      const share = input.payer ? b.shares.find((s) => s.payer === input.payer) : null;
      const budget = input.payer ? (share ? share.cents : null) : b.cents;
      const parts = input.payer
        ? []
        : b.shares.map((s) => {
            const partSlice: Slice = { ...base, payer: s.payer };
            const p = projectMonth(
              input.month,
              input.today,
              figuresFor(input.rows, input.pending, input.month, partSlice),
            );
            return {
              payer: s.payer,
              budget: s.cents,
              projection: p,
              comparison: comparisonFor(input.rows, input.month, partSlice),
              status: budgetStatus(p.projected, s.cents),
            };
          });
      // A próxima saída prevista: agendada (já lançada para depois de hoje) ou recorrência a lançar
      const future = [
        ...input.rows
          .filter(
            (r) => r.month === input.month && !r.upToToday && r.expense > 0n && matches(r, slice),
          )
          .flatMap((r) => (r.firstAfterToday ? [r.firstAfterToday] : [])),
        ...input.pending
          .filter((p) => p.month === input.month && matches(p, slice))
          .map((p) => p.date),
      ].toSorted();
      return {
        walletId: b.walletId,
        categoryId: b.categoryId,
        budget,
        fullBudget: b.cents,
        projection,
        comparison: comparisonFor(input.rows, input.month, slice),
        status: budgetStatus(projection.projected, budget),
        onlyFixed:
          figures.variableSpent === 0n && figures.scheduled + figures.pendingRecurrences > 0n,
        nextDue: future[0] ?? null,
        parts,
      };
    });
}

// ── Evolução mês a mês ────────────────────────────────────────────────────────

export type MonthPoint = {
  month: MonthKey;
  /** Gasto (no mês em andamento, até hoje) */
  spent: Cents;
  /** Previsto do mês inteiro (igual ao gasto nos meses fechados) */
  projected: Cents;
  /**
   * Orçado do recorte no mês: a soma dos orçados das categorias dentro dele. null quando não há
   * orçado OU quando ele não cobre todo o gasto do recorte (Moradia com só a Diarista orçada, ou
   * Restaurante orçado na Casa mas não no ambiente pessoal): comparar o gasto inteiro com uma
   * parte do orçado diria "acima" sem ser verdade.
   */
  budget: Cents | null;
};

/** O gasto mês a mês de um recorte, com o orçado (Evolução). */
export function monthlySeries(input: {
  rows: readonly SpendingRow[];
  pending: readonly PendingRow[];
  budgets: readonly BudgetRecord[];
  nodes: readonly CategoryNode[];
  months: readonly MonthKey[];
  today: CivilDate;
  slice: Slice;
}): MonthPoint[] {
  const { slice } = input;
  const inSlice = input.budgets.filter(
    (b) =>
      (!slice.walletId || b.walletId === slice.walletId) &&
      slice.categories !== "none" &&
      (!slice.categories || slice.categories.has(b.categoryId)) &&
      (!slice.payer || b.shares.some((s) => s.payer === slice.payer)),
  );
  const reach = new Map(inSlice.map((b) => [b, subtreeOf(b.categoryId, input.nodes)] as const));
  return input.months.map((month) => {
    const p = projectMonth(month, input.today, figuresFor(input.rows, input.pending, month, slice));
    const inMonth = inSlice.filter((b) => b.month === month);
    // Todo gasto do recorte no mês precisa estar debaixo de algum orçado do mesmo ambiente
    const covered = (r: { walletId: string; categoryId: string | null }) =>
      r.categoryId !== null &&
      inMonth.some((b) => b.walletId === r.walletId && reach.get(b)?.has(r.categoryId as string));
    const spending = [
      ...input.rows.filter((r) => r.month === month && r.expense > 0n && matches(r, slice)),
      ...input.pending.filter((r) => r.month === month && matches(r, slice)),
    ];
    const complete = inMonth.length > 0 && spending.every(covered);
    const amounts = inMonth.map((b) =>
      slice.payer ? (b.shares.find((s) => s.payer === slice.payer)?.cents ?? 0n) : b.cents,
    );
    return {
      month,
      spent: p.spent,
      projected: p.projected,
      budget: complete ? sumCents(amounts) : null,
    };
  });
}

/** O mês de hoje, para quem só tem a data. */
export const currentMonth = (today: CivilDate): MonthKey => monthOf(today);
