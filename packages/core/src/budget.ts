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
//   futuro       ainda não começou: o que já está certo (compras de uma fatura que vence nele,
//                parcelas e fixas agendadas) + o ritmo de uma fatura dele que ainda está aberta
//
// O previsto de um mês que não fechou (decisão do Danillo, M08; janelas no M13.3a, ADR-025):
//
//   previsto = gasto até hoje que conta no mês
//            + lançamentos depois de hoje (parcelas e fixas agendadas), pelo valor
//            + recorrências do mês que ainda não viraram lançamento, pelo valor
//            + o ritmo do variável em cada JANELA que ainda está aberta
//
// A janela é o período em que uma compra ainda entra no mês: nas contas, o próprio mês; no
// cartão, o período da fatura que vence nele (do fechamento anterior ao dia antes do fechamento).
// O ritmo de uma janela = o variável dela ÷ dias já passados nela × dias que faltam nela. Fatura
// já fechada não cresce mais. Só o variável é extrapolado: uma conta fixa de R$ 2.200 no dia 10
// não "acelera" o mês.
import {
  addMonthsToKey,
  compareCivil,
  daysBetween,
  daysInMonth,
  dayOfMonth,
  firstDayOf,
  monthOf,
  parseCivilDate,
  parseMonthKey,
} from "./dates";
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
 * Fixa, parcela ou variável (ADR-026). A ordem decide:
 * 1. parcela: a compra parcelada do FinTrack ou a parcela que o banco informa ("3 de 6", M13.3a).
 *    Sempre parcela, ninguém troca;
 * 2. a marca da compra (`nature`), quando a pessoa (ou a regra "as próximas desta loja") marcou;
 * 3. fixa, se veio de uma recorrência do app (conta fixa, assinatura);
 * 4. o padrão da categoria (`categoryNature`); sem categoria, variável.
 * A mesma regra está em SQL (NATURE_SQL, packages/db), com o teste de concordância.
 */
export type SpendingNature = "fixed" | "installment" | "variable";

/** O tipo que a pessoa escolhe (a coluna `nature` e o padrão da categoria). */
export type ExpenseNature = "FIXED" | "VARIABLE";

export const EXPENSE_NATURES: readonly ExpenseNature[] = ["FIXED", "VARIABLE"];

export type NatureInput = {
  recurrenceId: string | null;
  installmentGroupId: string | null;
  providerInstallmentCount?: number | null;
  /** A marca da compra; nula = segue a recorrência ou a categoria */
  nature?: ExpenseNature | null;
  /** O padrão da categoria da compra; nulo = sem categoria */
  categoryNature?: ExpenseNature | null;
};

export function spendingNature(t: NatureInput): SpendingNature {
  if (t.installmentGroupId || t.providerInstallmentCount) return "installment";
  if (t.nature) return t.nature === "FIXED" ? "fixed" : "variable";
  if (t.recurrenceId) return "fixed";
  return t.categoryNature === "FIXED" ? "fixed" : "variable";
}

/** Uma parcela não tem marca: a escolha de fixa ou variável não aparece nela. */
export function natureIsChoosable(t: NatureInput): boolean {
  return !t.installmentGroupId && !t.providerInstallmentCount;
}

/** O que a tela precisa para mostrar e trocar o tipo de uma despesa (a etiqueta da linha). */
export type NatureView = {
  kind: SpendingNature;
  /** Fixa ou variável pode ser escolhida (não é parcela) */
  choosable: boolean;
  /** O padrão da categoria (nulo = sem categoria): "Padrão de Assinaturas: Fixa" */
  categoryNature: ExpenseNature | null;
};

/** O tipo de uma saída para a tela; nulo numa entrada ou numa transferência (não têm tipo). */
export function natureView(
  t: NatureInput & { expense: boolean; transfer: boolean },
): NatureView | null {
  if (!t.expense || t.transfer) return null;
  return {
    kind: spendingNature(t),
    choosable: natureIsChoosable(t),
    categoryNature: t.categoryNature ?? null,
  };
}

/**
 * A marca que se grava num lançamento (ADR-026): só numa saída que não é parcela nem
 * transferência. Nas outras, nula (o CHECK do banco também barra).
 */
export function storedNature(t: {
  expense: boolean;
  installment: boolean;
  transfer: boolean;
  nature: ExpenseNature | null | undefined;
}): ExpenseNature | null {
  return t.expense && !t.installment && !t.transfer ? (t.nature ?? null) : null;
}

// ── O previsto de fim de mês ──────────────────────────────────────────────────

/**
 * A janela do ritmo (ADR-025): o período em que uma compra ainda entra no mês, com o primeiro e o
 * último dia (inclusive). As contas usam o próprio mês; cada fatura de cartão, o período dela.
 */
export type PaceWindow = { start: CivilDate; end: CivilDate };

/** A chave da janela das contas (o mês inteiro); a de um cartão é o id da fatura. */
export const ACCOUNTS_WINDOW = "contas";

/** A janela das contas num mês: do dia 1 ao último dia. */
export function monthWindow(month: MonthKey): PaceWindow {
  return { start: firstDayOf(month), end: dayOfMonth(month, 31) };
}

/** Um valor por tipo de despesa (fixa, parcela, variável). */
export type NatureCents = Readonly<Record<SpendingNature, Cents>>;

export const NO_NATURE_CENTS: NatureCents = { fixed: 0n, installment: 0n, variable: 0n };

export function addNatureCents(a: NatureCents, b: NatureCents): NatureCents {
  return {
    fixed: a.fixed + b.fixed,
    installment: a.installment + b.installment,
    variable: a.variable + b.variable,
  };
}

/** A soma dos três tipos. */
export function natureTotal(n: NatureCents): Cents {
  return n.fixed + n.installment + n.variable;
}

/** Um valor só num tipo. */
export function inNature(nature: SpendingNature, cents: Cents): NatureCents {
  return { ...NO_NATURE_CENTS, [nature]: cents };
}

/** O que se sabe de um mês (num recorte: uma categoria, um ambiente, uma pessoa). */
export type MonthFigures = {
  /** Gasto que conta no mês e já aconteceu (até hoje; no mês fechado, o mês inteiro), por tipo */
  spent: NatureCents;
  /** Lançamentos do mês com data depois de hoje (parcelas e fixas agendadas), por tipo */
  scheduled: NatureCents;
  /** O variável que já aconteceu, por janela (ACCOUNTS_WINDOW ou o id da fatura): o ritmo */
  variableByWindow: ReadonlyMap<string, Cents>;
  /**
   * As fixas que ainda não chegaram no mês (ADR-026): as recorrências do app ainda não lançadas,
   * pelo valor previsto, e as fixas do banco do mês passado que ainda não vieram neste. Sempre
   * fixas; entram uma vez, sem ritmo
   */
  pending: Cents;
};

export const NO_FIGURES: MonthFigures = {
  spent: NO_NATURE_CENTS,
  scheduled: NO_NATURE_CENTS,
  variableByWindow: new Map(),
  pending: 0n,
};

export function addFigures(a: MonthFigures, b: MonthFigures): MonthFigures {
  const byWindow = new Map(a.variableByWindow);
  for (const [key, cents] of b.variableByWindow) {
    byWindow.set(key, (byWindow.get(key) ?? 0n) + cents);
  }
  return {
    spent: addNatureCents(a.spent, b.spent),
    scheduled: addNatureCents(a.scheduled, b.scheduled),
    variableByWindow: byWindow,
    pending: a.pending + b.pending,
  };
}

export type Projection = {
  phase: MonthPhase;
  /** Gasto que conta no mês e já aconteceu */
  spent: Cents;
  /** Previsto para o mês inteiro (no fechado, igual ao gasto) */
  projected: Cents;
  /** O previsto por tipo (soma = projected): as fixas e as parcelas uma vez, o variável no ritmo */
  parts: NatureCents;
  /** Só a parte do previsto que vem do ritmo do variável (0 no mês fechado) */
  pace: Cents;
  /** Dias já passados e dias do mês (no mês em andamento) */
  elapsedDays: number;
  monthDays: number;
};

/**
 * O ritmo de uma janela até o fim dela: o variável ÷ dias passados × dias que faltam. Hoje antes
 * da janela (ainda não começou) ou depois do fim dela (fatura fechada): zero.
 */
export function windowPace(variable: Cents, window: PaceWindow, today: CivilDate): Cents {
  if (variable === 0n) return 0n;
  if (compareCivil(today, window.start) < 0 || compareCivil(today, window.end) >= 0) return 0n;
  const elapsed = BigInt(daysBetween(window.start, today) + 1);
  const remaining = BigInt(daysBetween(today, window.end));
  return divRound(variable * remaining, elapsed);
}

/**
 * O previsto do mês. `windows` traz o período de cada fatura que aparece em `variableByWindow`;
 * a janela que não está lá é a das contas (o mês).
 */
export function projectMonth(
  month: MonthKey,
  today: CivilDate,
  f: MonthFigures,
  windows: ReadonlyMap<string, PaceWindow> = new Map(),
): Projection {
  const { year, month: m } = parseMonthKey(month);
  const monthDays = daysInMonth(year, m);
  const phase = monthPhase(month, today);
  const spent = natureTotal(f.spent);
  if (phase === "closed") {
    return {
      phase,
      spent,
      projected: spent,
      parts: f.spent,
      pace: 0n,
      elapsedDays: monthDays,
      monthDays,
    };
  }
  let pace = 0n;
  for (const [key, variable] of f.variableByWindow) {
    pace += windowPace(variable, windows.get(key) ?? monthWindow(month), today);
  }
  // A fixa e a parcela entram uma vez: o que já saiu, o agendado e (a fixa) o que ainda falta
  // chegar. Só o variável segue o ritmo (ADR-026)
  const parts: NatureCents = {
    fixed: f.spent.fixed + f.scheduled.fixed + f.pending,
    installment: f.spent.installment + f.scheduled.installment,
    variable: f.spent.variable + f.scheduled.variable + pace,
  };
  return {
    phase,
    spent,
    projected: natureTotal(parts),
    parts,
    pace,
    elapsedDays: phase === "current" ? parseCivilDate(today).day : 0,
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
