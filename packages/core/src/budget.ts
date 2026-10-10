// Orçamento e painel (M08): as regras puras por trás de "como estamos este mês?".
//
// O banco soma (packages/db, agregações em SQL) e este arquivo decide o que os números querem
// dizer: o previsto de fim de mês, a média de 6 meses, quanto sobra ou passa do orçado, de que
// grupo é cada categoria e se a divisão do orçado entre as pessoas fecha. Sem banco e sem tela:
// testado em milissegundos e usado igual pelo painel, pelo orçamento e pela evolução.
//
// Os três tempos de um mês, em relação a hoje:
//
//   fechado      o mês já acabou: o gasto é o que aconteceu; não há previsão
//   em andamento o mês de hoje: gasto até hoje + o que já está previsto + o ritmo do variável
//   futuro       ainda não começou: só o que já está previsto (fixas, parcelas agendadas)
//
// O previsto do mês em andamento (decisão do Danillo, M08):
//
//   previsto = gasto até hoje
//            + lançamentos depois de hoje (parcelas e fixas agendadas), pelo valor
//            + recorrências do mês que ainda não viraram lançamento, pelo valor
//            + o ritmo do variável nos dias que faltam (gasto variável ÷ dias passados × dias que faltam)
//
// Só o variável é extrapolado: uma conta fixa de R$ 2.200 no dia 10 não "acelera" o mês.
import { daysInMonth, monthOf, parseCivilDate, parseMonthKey, addMonthsToKey } from "./dates";
import type { CivilDate, MonthKey } from "./dates";
import { sumCents, type Cents } from "./money";

// ── Contas com centavos ───────────────────────────────────────────────────────

/**
 * Divisão de bigint com arredondamento "metade para longe do zero", como no papel:
 * divRound(1661427n, 1000n) = 1661n; divRound(5n, 2n) = 3n; divRound(-5n, 2n) = -3n.
 * A divisão comum de bigint só corta a fração, e o previsto ficaria sempre um centavo abaixo.
 */
export function divRound(numerator: bigint, denominator: bigint): bigint {
  if (denominator === 0n) throw new Error("Divisão por zero");
  const negative = numerator < 0n !== denominator < 0n;
  const n = numerator < 0n ? -numerator : numerator;
  const d = denominator < 0n ? -denominator : denominator;
  const q = (2n * n + d) / (2n * d);
  return negative ? -q : q;
}

/** A média de uma lista de valores, arredondada ao centavo. Lista vazia: 0. */
export function averageCents(values: readonly Cents[]): Cents {
  if (values.length === 0) return 0n;
  return divRound(sumCents(values), BigInt(values.length));
}

/**
 * Quanto `value` está acima (positivo) ou abaixo (negativo) de `base`, em pontos percentuais
 * inteiros: percentVersus(1661_43n, 1352_10n) = 23n. Base zero não tem comparação: null.
 */
export function percentVersus(value: Cents, base: Cents): bigint | null {
  if (base === 0n) return null;
  return divRound((value - base) * 100n, base);
}

// ── Os tempos do mês ──────────────────────────────────────────────────────────

export type MonthPhase = "closed" | "current" | "future";

/** O mês já acabou, é o de hoje ou ainda vem? */
export function monthPhase(month: MonthKey, today: CivilDate): MonthPhase {
  parseMonthKey(month);
  const current = monthOf(today);
  return month < current ? "closed" : month === current ? "current" : "future";
}

/** Os `count` meses anteriores a `month`, do mais antigo ao mais recente. */
export function monthsBefore(month: MonthKey, count: number): MonthKey[] {
  return Array.from({ length: count }, (_, i) => addMonthsToKey(month, i - count));
}

/** `count` meses terminando em `last` (inclusive), do mais antigo ao mais recente. */
export function monthsEndingAt(last: MonthKey, count: number): MonthKey[] {
  return Array.from({ length: count }, (_, i) => addMonthsToKey(last, i - count + 1));
}

/** `count` meses começando em `first` (inclusive). */
export function monthsStartingAt(first: MonthKey, count: number): MonthKey[] {
  return Array.from({ length: count }, (_, i) => addMonthsToKey(first, i));
}

// ── Natureza do gasto ─────────────────────────────────────────────────────────

/**
 * Fixa = gerada por uma recorrência (conta fixa, assinatura); parcela = de uma compra
 * parcelada; variável = todo o resto. Não é coluna: sai do lançamento (ADR-004).
 */
export type SpendingNature = "fixed" | "installment" | "variable";

export function spendingNature(t: {
  recurrenceId: string | null;
  installmentGroupId: string | null;
}): SpendingNature {
  if (t.recurrenceId) return "fixed";
  if (t.installmentGroupId) return "installment";
  return "variable";
}

// ── O previsto de fim de mês ──────────────────────────────────────────────────

/** O que se sabe de um mês (num recorte: uma categoria, um ambiente, uma pessoa). */
export type MonthFigures = {
  /** Gasto do dia 1 até hoje (no mês fechado, o mês inteiro). Positivo */
  spent: Cents;
  /** A parte variável do `spent` (sem recorrência e sem parcela) */
  variableSpent: Cents;
  /** Lançamentos do mês com data depois de hoje (parcelas e fixas agendadas) */
  scheduled: Cents;
  /** Recorrências do mês que ainda não viraram lançamento, pelo valor previsto */
  pendingRecurrences: Cents;
};

export const NO_FIGURES: MonthFigures = {
  spent: 0n,
  variableSpent: 0n,
  scheduled: 0n,
  pendingRecurrences: 0n,
};

export function addFigures(a: MonthFigures, b: MonthFigures): MonthFigures {
  return {
    spent: a.spent + b.spent,
    variableSpent: a.variableSpent + b.variableSpent,
    scheduled: a.scheduled + b.scheduled,
    pendingRecurrences: a.pendingRecurrences + b.pendingRecurrences,
  };
}

export type Projection = {
  phase: MonthPhase;
  /** Gasto até hoje (no futuro, 0) */
  spent: Cents;
  /** Previsto para o mês inteiro (no fechado, igual ao gasto) */
  projected: Cents;
  /** Só a parte do previsto que vem do ritmo do variável (0 fora do mês em andamento) */
  pace: Cents;
  /** Dias já passados e dias do mês (no mês em andamento) */
  elapsedDays: number;
  monthDays: number;
};

export function projectMonth(month: MonthKey, today: CivilDate, f: MonthFigures): Projection {
  const { year, month: m } = parseMonthKey(month);
  const monthDays = daysInMonth(year, m);
  const phase = monthPhase(month, today);
  if (phase === "closed") {
    return {
      phase,
      spent: f.spent,
      projected: f.spent,
      pace: 0n,
      elapsedDays: monthDays,
      monthDays,
    };
  }
  if (phase === "future") {
    const projected = f.scheduled + f.pendingRecurrences;
    return { phase, spent: 0n, projected, pace: 0n, elapsedDays: 0, monthDays };
  }
  const elapsedDays = parseCivilDate(today).day;
  const remaining = BigInt(monthDays - elapsedDays);
  const pace = divRound(f.variableSpent * remaining, BigInt(elapsedDays));
  return {
    phase,
    spent: f.spent,
    projected: f.spent + f.scheduled + f.pendingRecurrences + pace,
    pace,
    elapsedDays,
    monthDays,
  };
}

// ── Orçado × previsto ─────────────────────────────────────────────────────────

/** Acima do orçado (quanto passa), dentro (quanto sobra) ou sem orçado. */
export type BudgetStatus =
  { kind: "over"; by: Cents } | { kind: "within"; left: Cents } | { kind: "none" };

export function budgetStatus(projected: Cents, budget: Cents | null): BudgetStatus {
  if (budget === null) return { kind: "none" };
  return projected > budget
    ? { kind: "over", by: projected - budget }
    : { kind: "within", left: budget - projected };
}

// ── Categorias em árvore ──────────────────────────────────────────────────────

/** O mínimo de uma categoria para andar na árvore. */
export type CategoryNode = { id: string; parentId: string | null };

/**
 * O grupo de uma categoria: a categoria de primeiro nível acima dela (ela mesma, se já for de
 * primeiro nível). Mercado → Alimentação. É por grupo que o painel e a evolução somam.
 * Uma volta na árvore (dado corrompido) para na primeira repetição, sem travar.
 */
export function categoryGroupOf(id: string, parents: ReadonlyMap<string, string | null>): string {
  let current = id;
  const seen = new Set<string>();
  for (;;) {
    const parent = parents.get(current) ?? null;
    if (parent === null || seen.has(parent)) return current;
    seen.add(current);
    current = parent;
  }
}

/** A categoria e todas as que estão embaixo dela (filhas, netas...). */
export function subtreeOf(id: string, nodes: readonly CategoryNode[]): Set<string> {
  const children = new Map<string, string[]>();
  for (const n of nodes) {
    if (n.parentId === null) continue;
    children.set(n.parentId, [...(children.get(n.parentId) ?? []), n.id]);
  }
  const result = new Set<string>([id]);
  const queue = [id];
  while (queue.length > 0) {
    const next = queue.shift() as string;
    for (const child of children.get(next) ?? []) {
      if (!result.has(child)) {
        result.add(child);
        queue.push(child);
      }
    }
  }
  return result;
}

/**
 * Regra do nível do orçamento: num mesmo ambiente e mês, uma categoria só recebe orçado se nenhuma
 * categoria acima ou abaixo dela já tiver. Assim o gasto de uma linha (a categoria e as de baixo)
 * nunca é contado em duas linhas, e o clique da linha mostra exatamente os lançamentos dela.
 * Devolve o id da categoria que conflita, ou null.
 */
export function budgetLevelConflict(
  categoryId: string,
  budgeted: Iterable<string>,
  nodes: readonly CategoryNode[],
): string | null {
  const below = subtreeOf(categoryId, nodes);
  const parents = new Map(nodes.map((n) => [n.id, n.parentId] as const));
  const above = new Set<string>();
  for (let p = parents.get(categoryId) ?? null; p !== null && !above.has(p);) {
    above.add(p);
    p = parents.get(p) ?? null;
  }
  for (const other of budgeted) {
    if (other === categoryId) continue;
    if (below.has(other) || above.has(other)) return other;
  }
  return null;
}

// ── Divisão do orçado por quem paga ───────────────────────────────────────────

/**
 * Uma parte do orçado de uma categoria num ambiente compartilhado (decisão do Danillo, M08:
 * "por ambiente e por pessoa"). `payer` é o mesmo valor do filtro "Pago por": o id da pessoa
 * ou "compartilhado".
 */
export type BudgetShare = { payer: string; cents: Cents };

export type ShareProblem = "SHARES_DUPLICATED" | "SHARES_NEGATIVE" | "SHARES_SUM_MISMATCH";

/**
 * A divisão fecha? O orçado da categoria é a soma das partes (DV + NV + CP = total): uma pessoa
 * só aparece uma vez, nenhuma parte é negativa e a soma bate ao centavo. Lista vazia = sem
 * divisão (sempre vale).
 */
export function checkShares(total: Cents, shares: readonly BudgetShare[]): ShareProblem | null {
  if (shares.length === 0) return null;
  if (new Set(shares.map((s) => s.payer)).size !== shares.length) return "SHARES_DUPLICATED";
  if (shares.some((s) => s.cents < 0n)) return "SHARES_NEGATIVE";
  if (sumCents(shares.map((s) => s.cents)) !== total) return "SHARES_SUM_MISMATCH";
  return null;
}

// ── Copiar do mês anterior ────────────────────────────────────────────────────

export type BudgetLine = { categoryId: string; cents: Cents; shares: readonly BudgetShare[] };

/**
 * "Copiar do mês anterior" (decisão do M08): só preenche as categorias que ainda não têm valor
 * no mês; nunca sobrescreve. Também pula a que quebraria a regra do nível (veja
 * budgetLevelConflict). Devolve o que copiar e quantas ficaram como estavam.
 */
export function budgetsToCopy(
  previous: readonly BudgetLine[],
  current: readonly { categoryId: string }[],
  nodes: readonly CategoryNode[],
): { copy: BudgetLine[]; kept: number } {
  const taken = new Set(current.map((c) => c.categoryId));
  const copy: BudgetLine[] = [];
  let kept = 0;
  for (const line of previous) {
    if (taken.has(line.categoryId)) {
      kept += 1;
      continue;
    }
    if (budgetLevelConflict(line.categoryId, taken, nodes) !== null) {
      kept += 1;
      continue;
    }
    copy.push(line);
    taken.add(line.categoryId);
  }
  return { copy, kept };
}
