// Como a lista de lançamentos se apresenta (M07.2): os títulos dos dias e os atalhos de período.
// Funções puras, testadas em presentation.test.ts. "Hoje" vem do servidor (todayISO, fuso de
// São Paulo), nunca do relógio do navegador.
import {
  addDays,
  addMonthsToKey,
  dayOfMonth,
  firstDayOf,
  monthOf,
  type CivilDate,
  type MonthKey,
} from "@fintrack/core";
import type { ListPeriod } from "./schemas";

const weekday = new Intl.DateTimeFormat("pt-BR", { weekday: "long", timeZone: "UTC" });
const dayMonth = new Intl.DateTimeFormat("pt-BR", {
  day: "numeric",
  month: "long",
  timeZone: "UTC",
});
const dayMonthYear = new Intl.DateTimeFormat("pt-BR", {
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

const asDate = (d: CivilDate) => new Date(`${d}T12:00:00Z`);

/** "Hoje, quinta-feira, 8 de outubro" · "Ontem, …" · "terça-feira, 6 de outubro" · com o ano se for outro. */
export function dayLabel(date: CivilDate, today: CivilDate): string {
  const d = asDate(date);
  const sameYear = date.slice(0, 4) === today.slice(0, 4);
  const base = `${weekday.format(d)}, ${(sameYear ? dayMonth : dayMonthYear).format(d)}`;
  if (date === today) return `Hoje, ${base}`;
  if (date === addDays(today, -1)) return `Ontem, ${base}`;
  return base.charAt(0).toUpperCase() + base.slice(1);
}

export type PeriodPreset = { label: string; months: MonthKey[] };

/** Os atalhos do combo do Período (M13.3a): este mês, o mês passado e os últimos 3 meses. */
export function periodPresets(today: CivilDate): PeriodPreset[] {
  const month = monthOf(today);
  return [
    { label: "Este mês", months: [month] },
    { label: "Mês passado", months: [addMonthsToKey(month, -1)] },
    { label: "Últimos 3 meses", months: [-2, -1, 0].map((n) => addMonthsToKey(month, n)) },
  ];
}

/** Os meses que o combo oferece: os 12 até o de hoje, do mais recente para o mais antigo. */
export function periodChoices(today: CivilDate): MonthKey[] {
  const month = monthOf(today);
  return Array.from({ length: 12 }, (_, i) => addMonthsToKey(month, -i));
}

const monthNameFmt = new Intl.DateTimeFormat("pt-BR", { month: "long", timeZone: "UTC" });
const capital = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** "Novembro", sem o ano. */
export function monthName(month: MonthKey): string {
  return capital(monthNameFmt.format(new Date(`${month}-15T12:00:00Z`)));
}

/** "Novembro"; "Novembro de 2025" quando o ano não é o de hoje. */
export function monthTitle(month: MonthKey, today: CivilDate): string {
  const name = monthName(month);
  return month.slice(0, 4) === today.slice(0, 4) ? name : `${name} de ${month.slice(0, 4)}`;
}

const list = new Intl.ListFormat("pt-BR", { type: "conjunction" });

/**
 * O período por extenso, para o título da lista: "Novembro", "Setembro a novembro" (meses
 * seguidos), "Agosto e outubro" (meses soltos) ou "01/11 a 03/11" (dias).
 */
export function periodTitle(period: ListPeriod, today: CivilDate): string {
  if (period.kind === "range") {
    const month = monthOf(period.from);
    // Dias que são um mês inteiro (o que um número do painel abre) são o mês
    if (period.from === firstDayOf(month) && period.to === dayOfMonth(month, 31)) {
      return monthTitle(month, today);
    }
    const short = (d: CivilDate) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
    return `${short(period.from)} a ${short(period.to)}`;
  }
  const months = [...period.months].toSorted();
  const first = months[0] as MonthKey;
  const last = months.at(-1) as MonthKey;
  if (months.length === 1) return monthTitle(first, today);
  const contiguous = months.every(
    (m, i) => i === 0 || addMonthsToKey(months[i - 1] as MonthKey, 1) === m,
  );
  if (contiguous) return `${monthTitle(first, today)} a ${monthTitle(last, today).toLowerCase()}`;
  return capital(list.format(months.map((m) => monthTitle(m, today).toLowerCase())));
}

/** O valor curto do combo: "Novembro", "3 meses" ou "01/11 a 03/11". */
export function periodShort(period: ListPeriod, today: CivilDate): string {
  if (period.kind === "months" && period.months.length > 1) return `${period.months.length} meses`;
  return periodTitle(period, today);
}

/** O dia por extenso, para "Saldo em 1º de novembro". */
export function dayInWords(date: CivilDate): string {
  const day = Number.parseInt(date.slice(8, 10), 10);
  const month = monthNameFmt.format(new Date(`${date}T12:00:00Z`));
  return `${day === 1 ? "1º" : day} de ${month}`;
}

/**
 * O título do recorte de um número do painel (M13.3a): o que soma e o período. "Mercado ·
 * novembro até 04/11", "Saídas · novembro".
 */
export function sliceTitle(input: {
  category: string | null;
  type: "expense" | "income" | "transfer" | null;
  period: ListPeriod;
  upTo: CivilDate | null;
  today: CivilDate;
}): string {
  const what =
    input.category ??
    (input.type === "expense" ? "Saídas" : input.type === "income" ? "Entradas" : "Recorte");
  const period = periodTitle(input.period, input.today).toLowerCase();
  const until = input.upTo ? ` até ${input.upTo.slice(8, 10)}/${input.upTo.slice(5, 7)}` : "";
  return `${what} · ${period}${until}`;
}
