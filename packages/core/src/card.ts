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
  addMonthsToKey,
  compareCivil,
  dayOfMonth,
  monthOf,
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
