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
} from "@fintrack/core";

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

export type PeriodPreset = { label: string; from: CivilDate; to: CivilDate };

/** Os atalhos de período da lista: este mês, mês passado e os últimos 3 meses. */
export function periodPresets(today: CivilDate): PeriodPreset[] {
  const month = monthOf(today);
  const last = addMonthsToKey(month, -1);
  return [
    { label: "Este mês", from: firstDayOf(month), to: dayOfMonth(month, 31) },
    { label: "Mês passado", from: firstDayOf(last), to: dayOfMonth(last, 31) },
    {
      label: "Últimos 3 meses",
      from: firstDayOf(addMonthsToKey(month, -2)),
      to: dayOfMonth(month, 31),
    },
  ];
}
