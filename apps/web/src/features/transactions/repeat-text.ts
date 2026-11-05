// Como o que se repete se escreve na tela (M13.3c, ADR-027): o dia, a regra do valor e o fim.
// Funções puras, testadas em repeat-text.test.ts; as telas (Fixas e parcelas, o tipo do
// lançamento, as previstas) usam as mesmas frases.
import type { CivilDate, RecurrenceAmountRule, RecurrenceDayRule } from "@fintrack/core";

/** A regra do valor como opção de escolha ("Média de 3 meses"). */
export const AMOUNT_RULE_LABEL: Record<RecurrenceAmountRule, string> = {
  LAST: "O último",
  AVERAGE_3: "Média de 3 meses",
  FIXED: "Um valor fixo",
};

/** A regra do valor ao lado do valor previsto ("média de 3 meses · varia"). */
export const AMOUNT_RULE_NOTE: Record<RecurrenceAmountRule, string> = {
  LAST: "o último que chegou",
  AVERAGE_3: "média de 3 meses · varia",
  FIXED: "valor fixo",
};

const pad = (n: number) => String(n).padStart(2, "0");

/** "todo dia 05" ou "5º dia útil". */
export function dayText(rule: RecurrenceDayRule, day: number): string {
  return rule === "BUSINESS_DAY" ? `${day}º dia útil` : `todo dia ${pad(day)}`;
}

/** "por volta do dia 5" ou "no 5º dia útil" (a frase do "Quando cai"). */
export function whenText(rule: RecurrenceDayRule, day: number): string {
  return rule === "BUSINESS_DAY" ? `no ${day}º dia útil` : `por volta do dia ${day}`;
}

const monthShort = new Intl.DateTimeFormat("pt-BR", { month: "short", timeZone: "UTC" });

/** "sem fim" ou "até dez/2026". */
export function endsText(endsOn: CivilDate | null): string {
  if (!endsOn) return "sem fim";
  const month = monthShort.format(new Date(`${endsOn}T12:00:00Z`)).replace(".", "");
  return `até ${month}/${endsOn.slice(0, 4)}`;
}
