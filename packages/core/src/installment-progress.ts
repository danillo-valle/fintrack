// As compras parceladas em andamento (M13.3a, a parte "Parceladas" de Fixas e parcelas): a do
// FinTrack (todas as parcelas já gravadas, uma por fatura) e a que o banco informa ("2/5": só as
// parcelas que já chegaram). Uma regra só para as duas:
//
//   a parcela de agora = a maior parcela que vence até a próxima fatura da compra (a primeira que
//                        vence de hoje em diante); sem nenhuma por vencer, a última que chegou
//   faltam             = o total de parcelas menos a de agora, pelo valor dela
//   termina            = o mês do vencimento da de agora mais as que faltam
//
// A compra some da lista quando a última parcela é a de agora.
import { addMonthsToKey, compareCivil, monthOf, type CivilDate, type MonthKey } from "./dates";
import type { Cents } from "./money";

/** Uma parcela gravada: a chave da compra, o número, o total e o vencimento da fatura dela. */
export type InstallmentParcel = {
  /** A compra: o id da compra parcelada do FinTrack, ou a chave das parcelas do banco */
  key: string;
  number: number;
  count: number;
  /** Com sinal (a compra é negativa) */
  amount: Cents;
  dueDate: CivilDate;
};

export type InstallmentInProgress = {
  key: string;
  /** A parcela de agora (2 de 5) */
  number: number;
  count: number;
  /** O valor de uma parcela (positivo) */
  perParcel: Cents;
  /** Quantas faltam depois da de agora, e quanto somam */
  remainingCount: number;
  remaining: Cents;
  /** O mês do vencimento da última parcela */
  endsIn: MonthKey;
};

export function installmentsInProgress(
  parcels: readonly InstallmentParcel[],
  today: CivilDate,
): InstallmentInProgress[] {
  const byKey = new Map<string, InstallmentParcel[]>();
  for (const p of parcels) byKey.set(p.key, [...(byKey.get(p.key) ?? []), p]);
  const result: InstallmentInProgress[] = [];
  for (const [key, list] of byKey) {
    const upcoming = list
      .filter((p) => compareCivil(p.dueDate, today) >= 0)
      .map((p) => p.dueDate)
      .toSorted()[0];
    const reached = upcoming ? list.filter((p) => compareCivil(p.dueDate, upcoming) <= 0) : list;
    const current = reached.reduce((best, p) => (p.number > best.number ? p : best));
    const remainingCount = current.count - current.number;
    if (remainingCount <= 0) continue;
    const perParcel = current.amount < 0n ? -current.amount : current.amount;
    result.push({
      key,
      number: current.number,
      count: current.count,
      perParcel,
      remainingCount,
      remaining: perParcel * BigInt(remainingCount),
      endsIn: addMonthsToKey(monthOf(current.dueDate), remainingCount),
    });
  }
  return result.toSorted((a, b) =>
    a.remaining === b.remaining ? 0 : a.remaining > b.remaining ? -1 : 1,
  );
}
