// Cartão de crédito: regime de COMPETÊNCIA (a fatura em que a compra entra) separado do
// regime de CAIXA (o dia em que o dinheiro sai da conta, no vencimento).
//
// Uma compra em 28/09 num cartão que fecha dia 25 e vence dia 5 entra na fatura de
// OUTUBRO (fecha 25/10) e só é paga em 05/11. Quem soma gastos pela data da compra e
// quem raciocina pela fatura chegam a números diferentes; o FinTrack guarda os dois.
//
//        fechamento 25/09            fechamento 25/10            vencimento 05/11
//   ─────────┼────────── compra 28/09 ───────┼──────────────────────────┼─────────
//            │  ← fatura de outubro (ref. 2026-10) →│   paga no vencimento   │
//
// Regra adotada (a mais comum nos bancos brasileiros): compras ANTES do dia do fechamento
// entram na fatura daquele mês; a partir do dia do fechamento, na fatura seguinte.
// Por isso o "melhor dia de compra" é o próprio dia do fechamento: é o que dá mais prazo.
// Confira no seu banco; no M09, a fatura oficial (Open Finance) confirma ou corrige.
import { installmentAmounts, type Cents } from "./money";
import {
  addDays,
  addMonths,
  addMonthsToKey,
  compareCivil,
  daysBetween,
  dayOfMonth,
  monthOf,
  parseCivilDate,
  parseMonthKey,
  type CivilDate,
  type MonthKey,
} from "./dates";

/** Ciclo do cartão: dia do fechamento e dia do vencimento (de 1 a 31). */
export type CardCycle = { closingDay: number; dueDay: number };

/** Uma fatura: o mês de referência (competência), o fechamento e o vencimento (caixa). */
export type Statement = {
  /** Mês da fatura, que é o mês do fechamento: "2026-10". */
  referenceMonth: MonthKey;
  /** Último dia em que a fatura aceita compras é o dia ANTERIOR a este. */
  closingDate: CivilDate;
  /** Dia em que a fatura é paga (o dinheiro sai da conta). */
  dueDate: CivilDate;
};

/** Confere o ciclo: dias de 1 a 31 e vencimento diferente do fechamento. */
export function assertCardCycle(cycle: CardCycle): void {
  for (const [name, day] of [
    ["fechamento", cycle.closingDay],
    ["vencimento", cycle.dueDay],
  ] as const) {
    if (!Number.isInteger(day) || day < 1 || day > 31) {
      throw new Error(`Dia de ${name} inválido: ${day} (de 1 a 31)`);
    }
  }
  if (cycle.closingDay === cycle.dueDay) {
    throw new Error("O vencimento precisa ser num dia diferente do fechamento");
  }
}

/**
 * A fatura de um mês de referência.
 * Fechamento: dia `closingDay` do mês (ou o último dia, se o mês for mais curto).
 * Vencimento: a primeira vez que o dia `dueDay` aparece DEPOIS do fechamento. Na prática,
 * no mesmo mês quando o vencimento vem depois (fecha 3, vence 10) e no mês seguinte quando
 * vem antes (fecha 25, vence 5). Assim, mesmo um ciclo "fecha 30, vence 31" funciona em
 * fevereiro, onde os dois dias encostariam no 28.
 */
export function statementOfMonth(referenceMonth: MonthKey, cycle: CardCycle): Statement {
  assertCardCycle(cycle);
  parseMonthKey(referenceMonth);
  const closingDate = dayOfMonth(referenceMonth, cycle.closingDay);
  const sameMonthDue = dayOfMonth(referenceMonth, cycle.dueDay);
  const dueDate =
    compareCivil(sameMonthDue, closingDate) > 0
      ? sameMonthDue
      : dayOfMonth(addMonthsToKey(referenceMonth, 1), cycle.dueDay);
  return { referenceMonth, closingDate, dueDate };
}

/** A fatura em que entra uma compra feita no dia `purchasedOn`. */
export function statementFor(purchasedOn: CivilDate, cycle: CardCycle): Statement {
  const month = monthOf(purchasedOn);
  const sameMonth = statementOfMonth(month, cycle);
  // Antes do fechamento: fatura deste mês. No dia do fechamento ou depois: a do mês seguinte.
  return compareCivil(purchasedOn, sameMonth.closingDate) < 0
    ? sameMonth
    : statementOfMonth(addMonthsToKey(month, 1), cycle);
}

/**
 * A fatura que vence no mês `dueMonth` (M13.3c, a próxima fatura antes de abrir): a do mês de
 * referência igual (vence depois do fechamento, no mesmo mês) ou a do mês anterior (vence no mês
 * seguinte ao do fechamento).
 */
export function statementDueIn(dueMonth: MonthKey, cycle: CardCycle): Statement {
  const same = statementOfMonth(dueMonth, cycle);
  if (monthOf(same.dueDate) === dueMonth) return same;
  return statementOfMonth(addMonthsToKey(dueMonth, -1), cycle);
}

/**
 * As faturas que ainda não existem e já têm alguma prevista (ADR-027): uma por mês de vencimento
 * das previstas que não cai em nenhuma fatura gravada, pelo ciclo do cartão, em ordem.
 */
export function futureStatements(
  known: readonly { dueDate: CivilDate }[],
  forecastDueDates: readonly CivilDate[],
  cycle: CardCycle,
): Statement[] {
  const knownMonths = new Set(known.map((s) => monthOf(s.dueDate)));
  const months = [...new Set(forecastDueDates.map(monthOf))]
    .filter((m) => !knownMonths.has(m))
    .toSorted();
  return months.map((m) => statementDueIn(m, cycle));
}

/** Uma parcela de compra parcelada, já com a fatura em que ela cai. */
export type Installment = { number: number; amount: Cents } & Statement;

/**
 * Plano de uma compra parcelada no cartão: o valor de cada parcela e a fatura de cada uma.
 * A 1ª parcela cai na fatura da compra; cada parcela seguinte, na fatura do mês seguinte.
 *
 *   installmentPlan({ total: -120000n, count: 3, purchasedOn: "2026-09-28",
 *                     cycle: { closingDay: 25, dueDay: 5 } })
 *   → 1/3 -400,00 na fatura 2026-10 (vence 05/11), 2/3 na 2026-11, 3/3 na 2026-12
 */
export function installmentPlan(input: {
  total: Cents;
  count: number;
  purchasedOn: CivilDate;
  cycle: CardCycle;
}): Installment[] {
  const first = statementFor(input.purchasedOn, input.cycle);
  return installmentAmounts(input.total, input.count).map((amount, index) => ({
    number: index + 1,
    amount,
    ...statementOfMonth(addMonthsToKey(first.referenceMonth, index), input.cycle),
  }));
}

/** Uma parcela pronta para virar lançamento: o plano, o dia em que ela aparece e a situação. */
export type InstallmentEntry = Installment & {
  /** O mesmo dia da compra, mês a mês (31 vira o último dia nos meses mais curtos) */
  occurredOn: CivilDate;
  /** Parcela que já chegou (até hoje) é CONFIRMED; as futuras ficam SCHEDULED (agendadas) */
  status: "CONFIRMED" | "SCHEDULED";
};

/**
 * As parcelas de uma compra no cartão como lançamentos (M07.4): o valor e a fatura de cada uma
 * (installmentPlan) e o dia em que ela aparece na lista. A parcela 1 aparece no dia da compra; a
 * 2 no mesmo dia do mês seguinte, e assim por diante. Assim, a lista de cada mês mostra a parcela
 * daquele mês, e as futuras aparecem como agendadas.
 *
 *   installmentEntries({ total: -4235n, count: 3, purchasedOn: "2026-10-08",
 *                        cycle: { closingDay: 25, dueDay: 5 }, today: "2026-10-08" })
 *   → 08/10 −14,13 (confirmada), 08/11 −14,11 e 08/12 −14,11 (agendadas)
 */
export function installmentEntries(input: {
  total: Cents;
  count: number;
  purchasedOn: CivilDate;
  cycle: CardCycle;
  today: CivilDate;
}): InstallmentEntry[] {
  const { day } = parseCivilDate(input.purchasedOn);
  const month = monthOf(input.purchasedOn);
  return installmentPlan(input).map((installment) => {
    const occurredOn = dayOfMonth(addMonthsToKey(month, installment.number - 1), day);
    return {
      ...installment,
      occurredOn,
      status: compareCivil(occurredOn, input.today) <= 0 ? "CONFIRMED" : "SCHEDULED",
    };
  });
}

// ── O período de uma fatura gravada (M13.3a, ADR-025) ───────────────────────────

/**
 * Até quantos dias depois do fechamento anterior a fatura seguinte ainda começa nele. Um ciclo
 * tem de 28 a 31 dias, e o banco às vezes muda o dia do fechamento (3 → 5); mais que isso é uma
 * fatura que não foi gravada no meio (um mês sem compra), e o período volta a ser de um mês.
 * O mesmo número está na função `fintrack_statement_for` do banco (migração do M13.3a).
 */
export const STATEMENT_GAP_DAYS = 45;

/**
 * O período das compras de uma fatura gravada: do fechamento anterior (inclusive) até o dia
 * antes do fechamento dela. Sem fechamento anterior próximo, um mês antes do fechamento.
 *
 *   statementWindow({ closingDate: "2026-11-03", previousClosingDate: "2026-10-03" })
 *   → { start: "2026-10-03", end: "2026-11-02" }
 */
export function statementWindow(input: {
  closingDate: CivilDate;
  previousClosingDate: CivilDate | null;
}): { start: CivilDate; end: CivilDate } {
  const { closingDate, previousClosingDate } = input;
  const contiguous =
    previousClosingDate !== null &&
    compareCivil(previousClosingDate, closingDate) < 0 &&
    daysBetween(previousClosingDate, closingDate) <= STATEMENT_GAP_DAYS;
  const start = contiguous ? previousClosingDate : addMonths(closingDate, -1);
  return { start, end: addDays(closingDate, -1) };
}

/**
 * Em que pé está uma fatura hoje (a página de Cartões, M13.3a):
 *   upcoming  ainda não abriu (só parcelas já marcadas para ela)
 *   open      aberta: ainda entram compras
 *   closed    fechada, esperando o pagamento
 *   paid      paga
 */
export type StatementState = "upcoming" | "open" | "closed" | "paid";

export function statementState(input: {
  window: { start: CivilDate; end: CivilDate };
  today: CivilDate;
  paid: boolean;
}): StatementState {
  if (compareCivil(input.today, input.window.start) < 0) return "upcoming";
  if (compareCivil(input.today, input.window.end) <= 0) return "open";
  return input.paid ? "paid" : "closed";
}

/**
 * A fatura que a página de Cartões abre primeiro (M13.3a): a primeira que ainda vai vencer (a
 * aberta, ou a fechada esperando o pagamento); sem nenhuma, a última que venceu. `statements` em
 * ordem de vencimento.
 */
export function defaultStatement<T extends { dueDate: CivilDate }>(
  statements: readonly T[],
  today: CivilDate,
): T | null {
  return statements.find((s) => compareCivil(s.dueDate, today) >= 0) ?? statements.at(-1) ?? null;
}
