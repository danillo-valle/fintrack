// Fluxo de caixa previsto (M08): quando o dinheiro entra e sai da conta, mês a mês.
//
// Diferente do gasto do orçamento (que conta pela data da compra), aqui vale a data em que o
// dinheiro se mexe:
//
//   compra no cartão de crédito  → no VENCIMENTO da fatura (statementFor, do card.ts)
//   Pix, débito, boleto, dinheiro → no próprio dia
//   recorrência ainda não lançada → no dia dela (ou no vencimento da fatura, se for no cartão)
//
// O pagamento da fatura é uma transferência (ADR-004) e fica de fora: as compras do cartão já
// entram no vencimento, e contar o pagamento seria contar duas vezes.
//
// Decisões do Danillo (M08): horizonte de 6 meses e ponto de partida zero (o "resultado do mês",
// acumulado). O saldo real das contas chega com o Open Finance (M09) e passa a ser o começo.
import { statementFor, type CardCycle } from "./card";
import { addMonthsToKey, compareCivil, monthOf, type CivilDate, type MonthKey } from "./dates";
import { flowOf } from "./flow";
import { occurrenceIn, type AccountKind, type RecurrenceLike } from "./transactions";
import type { Cents } from "./money";

/** Os três grupos da tabela: entradas, despesas fixas e o resto (faturas e outras saídas). */
export type CashBucket = "income" | "fixed" | "other";

/** Um movimento de dinheiro já com a data de caixa. `amount` com sinal (negativo = sai). */
export type CashMovement = { date: CivilDate; amount: Cents; bucket: CashBucket };

/** A conta de um lançamento, o suficiente para achar a data de caixa. */
export type CashAccount = { kind: AccountKind; cycle: CardCycle | null };

/**
 * A data em que o dinheiro sai (ou entra). Fatura já gravada (statementId) manda; sem ela, o
 * cartão de crédito usa o ciclo da conta; o resto sai no próprio dia.
 */
export function cashDateFor(
  occurredOn: CivilDate,
  account: CashAccount,
  statementDueDate: CivilDate | null = null,
): CivilDate {
  if (statementDueDate) return statementDueDate;
  if (account.kind === "CREDIT_CARD" && account.cycle) {
    return statementFor(occurredOn, account.cycle).dueDate;
  }
  return occurredOn;
}

/**
 * Entrada, despesa fixa (de uma recorrência) ou outra saída, pela regra flowOf (ADR-025): no
 * cartão, o estorno é uma saída negativa (abate a fatura), nunca uma entrada.
 */
export function cashBucketOf(
  t: { amount: Cents; accountKind: AccountKind },
  fromRecurrence: boolean,
): CashBucket {
  if (flowOf(t) === "income") return "income";
  return fromRecurrence ? "fixed" : "other";
}

export type CashFlowMonth = {
  month: MonthKey;
  /** Positivos: entradas, despesas fixas e outras saídas (faturas, Pix, débito...) */
  income: Cents;
  fixed: Cents;
  other: Cents;
  /** entradas − saídas do mês */
  net: Cents;
  /** soma dos `net` desde o primeiro mês do horizonte (começa em zero) */
  cumulative: Cents;
};

/** Junta os movimentos nos meses do horizonte; o que cai fora dele é ignorado. */
export function cashFlow(
  movements: readonly CashMovement[],
  months: readonly MonthKey[],
): CashFlowMonth[] {
  const byMonth = new Map(
    months.map((m) => [m, { income: 0n, fixed: 0n, other: 0n }] as [MonthKey, Totals]),
  );
  for (const mv of movements) {
    const bucket = byMonth.get(monthOf(mv.date));
    if (!bucket) continue;
    if (mv.bucket === "income") bucket.income += mv.amount;
    else if (mv.bucket === "fixed") bucket.fixed -= mv.amount;
    else bucket.other -= mv.amount;
  }
  let cumulative = 0n;
  return months.map((month) => {
    const t = byMonth.get(month) as Totals;
    const net = t.income - t.fixed - t.other;
    cumulative += net;
    return { month, ...t, net, cumulative };
  });
}

type Totals = { income: Cents; fixed: Cents; other: Cents };

// ── Recorrências que ainda não viraram lançamento ─────────────────────────────

/** Uma recorrência com o que ela precisa para virar previsão. */
export type ScheduledRecurrence = RecurrenceLike & {
  /** Valor com sinal (receita positiva, conta e assinatura negativas) */
  amount: Cents;
  /** Os meses em que ela JÁ gerou lançamento (esses não contam de novo) */
  materialized: ReadonlySet<MonthKey>;
  /** A conta: no cartão, a ocorrência conta no vencimento da fatura em que cai (ADR-025) */
  account: CashAccount;
};

/** Uma ocorrência ainda não lançada: o mês em que conta, o dia dela e o dia em que o dinheiro sai. */
export type PendingOccurrence = { month: MonthKey; date: CivilDate; cashDate: CivilDate };

/**
 * As ocorrências de uma recorrência que ainda não viraram lançamento e contam nos meses pedidos.
 * Conta no mês da data de caixa (ADR-025): a assinatura do dia 28 num cartão que fecha no dia 3
 * conta no mês do vencimento daquela fatura, como uma compra. Ocorrência de mês já fechado não
 * entra: se a conta não foi lançada, ela não aconteceu no FinTrack, e o orçamento de um mês que
 * passou mostra só o que aconteceu. "Já lançada" é pelo mês da ocorrência (`materialized`).
 */
export function pendingOccurrences(
  recurrence: ScheduledRecurrence,
  months: readonly MonthKey[],
  today: CivilDate,
): PendingOccurrence[] {
  if (months.length === 0) return [];
  const wanted = new Set(months);
  const current = monthOf(today);
  const sorted = [...months].sort();
  // Uma ocorrência no cartão conta até dois meses depois (compra depois do fechamento, vencimento
  // no mês seguinte ao do fechamento): começa a olhar dois meses antes do primeiro mês pedido
  const first = addMonthsToKey(sorted[0] as MonthKey, -2);
  const last = sorted.at(-1) as MonthKey;
  const result: PendingOccurrence[] = [];
  for (let month = first; month <= last; month = addMonthsToKey(month, 1)) {
    if (month < current || recurrence.materialized.has(month)) continue;
    const date = occurrenceIn(recurrence, month);
    if (!date) continue;
    const cashDate = cashDateFor(date, recurrence.account);
    const counted = monthOf(cashDate);
    if (wanted.has(counted)) result.push({ month: counted, date, cashDate });
  }
  return result;
}

/** true se a data é depois de hoje (para separar o que já aconteceu do que está previsto). */
export function isAfter(date: CivilDate, today: CivilDate): boolean {
  return compareCivil(date, today) > 0;
}
