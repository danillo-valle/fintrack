// As fixas que ainda vão chegar no mês (M13.3b, ADR-026). Uma fixa entra uma vez por mês no
// previsto: a que já chegou conta pelo valor dela; a que chegou no mês passado e ainda não veio
// neste conta pelo valor do mês passado. Assim o previsto não depende do ritmo para as fixas, e
// uma assinatura que chega no dia 2 não é multiplicada pelos dias que faltam.
import { merchantKey } from "./categorization";
import { addMonthsToKey, dayOfMonth, parseCivilDate, type CivilDate, type MonthKey } from "./dates";
import type { PendingRow } from "./dashboard";
import type { Cents } from "./money";

/** Uma saída fixa que já aconteceu (o banco ou uma recorrência do app). */
export type FixedCharge = {
  /** O mês da data de caixa (no cartão, o do vencimento da fatura) */
  month: MonthKey;
  /** A data de caixa */
  cashOn: CivilDate;
  walletId: string;
  categoryId: string | null;
  /** "Pago por" (como nas linhas do painel) */
  payer: string | null;
  /** O texto do banco ou a descrição digitada: é ele que diz "a mesma fixa" */
  description: string;
  /** O "O que foi", quando há: o nome que a tela mostra */
  label: string | null;
  /** A recorrência do app que gerou o lançamento, se gerou */
  recurrenceId: string | null;
  /** Positivo */
  expense: Cents;
};

/**
 * "A mesma fixa" em dois meses: a mesma recorrência do app, ou o mesmo comerciante (merchantKey do
 * texto do banco) no mesmo ambiente. O texto sem palavra que identifique fica inteiro.
 */
export function fixedChargeKey(c: FixedCharge): string {
  if (c.recurrenceId) return `r:${c.recurrenceId}`;
  const key = merchantKey(c.description);
  return `${c.walletId}|${key === "" ? c.description.trim().toLowerCase() : key}`;
}

/** Quantas fixas diferentes já chegaram no mês. */
export function fixedArrivals(charges: readonly FixedCharge[], month: MonthKey): number {
  return new Set(charges.filter((c) => c.month === month).map(fixedChargeKey)).size;
}

/**
 * As fixas do banco do mês passado que ainda não vieram em `month`, uma por fixa (a mais recente,
 * pelo valor dela), no mesmo dia do mês. As que vieram de recorrência do app ficam de fora: a
 * recorrência já diz sozinha o que falta (pendingOccurrences).
 */
export function missingFixedCharges(
  charges: readonly FixedCharge[],
  month: MonthKey,
): PendingRow[] {
  const previous = addMonthsToKey(month, -1);
  const arrived = new Set(charges.filter((c) => c.month === month).map(fixedChargeKey));
  const latest = new Map<string, FixedCharge>();
  for (const c of charges) {
    if (c.month !== previous || c.recurrenceId) continue;
    const key = fixedChargeKey(c);
    if (arrived.has(key)) continue;
    const seen = latest.get(key);
    if (!seen || c.cashOn > seen.cashOn) latest.set(key, c);
  }
  return [...latest.values()]
    .toSorted((a, b) => (a.cashOn < b.cashOn ? -1 : a.cashOn > b.cashOn ? 1 : 0))
    .map((c) => ({
      month,
      date: dayOfMonth(month, parseCivilDate(c.cashOn).day),
      walletId: c.walletId,
      categoryId: c.categoryId,
      payer: c.payer,
      expense: c.expense,
      source: "last-month" as const,
      name: c.label ?? c.description,
    }));
}
