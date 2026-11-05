// Dias úteis dos bancos (M13.3c, ADR-027): o "5º dia útil" do salário. Dia útil é de segunda a
// sexta, fora dos feriados nacionais em que os bancos fecham (o calendário da Febraban):
//
//   fixos     1º/1, 21/4, 1º/5, 7/9, 12/10, 2/11, 15/11, 20/11 (desde 2024) e 25/12
//   móveis    segunda e terça de Carnaval, Sexta-feira Santa e Corpus Christi (pela Páscoa)
//
// Feriado estadual e municipal fica de fora: o previsto é uma estimativa, e o dia que vale é o
// da cobrança que chegar.
import { addDays, civilDate, daysInMonth, parseCivilDate, parseMonthKey } from "./dates";
import type { CivilDate, MonthKey } from "./dates";

/** O domingo de Páscoa (o cálculo de Meeus/Jones/Butcher, calendário gregoriano). */
export function easterSunday(year: number): CivilDate {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return civilDate(year, month, day);
}

const FIXED_HOLIDAYS = ["01-01", "04-21", "05-01", "09-07", "10-12", "11-02", "11-15", "12-25"];

/** Os feriados nacionais em que os bancos fecham, no ano. */
export function bankHolidays(year: number): ReadonlySet<CivilDate> {
  const easter = easterSunday(year);
  const fixed = FIXED_HOLIDAYS.map((md) => `${year}-${md}`);
  // Dia da Consciência Negra: feriado nacional desde 2024 (Lei 14.759/2023)
  const blackConsciousness = year >= 2024 ? [`${year}-11-20`] : [];
  return new Set([
    ...fixed,
    ...blackConsciousness,
    addDays(easter, -48), // segunda de Carnaval
    addDays(easter, -47), // terça de Carnaval
    addDays(easter, -2), // Sexta-feira Santa
    addDays(easter, 60), // Corpus Christi
  ]);
}

/** O dia da semana: 0 = domingo, 6 = sábado (sem fuso: a data civil em UTC). */
function weekday(date: CivilDate): number {
  const { year, month, day } = parseCivilDate(date);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

/** true num dia em que os bancos abrem. */
export function isBusinessDay(date: CivilDate): boolean {
  const w = weekday(date);
  if (w === 0 || w === 6) return false;
  return !bankHolidays(parseCivilDate(date).year).has(date);
}

/**
 * O N-ésimo dia útil do mês (n a partir de 1). Num mês com menos dias úteis que n, o último dia
 * útil (o salário do "25º dia útil" ainda cai no mês).
 */
export function nthBusinessDay(month: MonthKey, n: number): CivilDate {
  if (!Number.isInteger(n) || n < 1) throw new Error(`Dia útil inválido: ${n}`);
  const { year, month: m } = parseMonthKey(month);
  let found = 0;
  let last: CivilDate | null = null;
  for (let day = 1; day <= daysInMonth(year, m); day += 1) {
    const date = civilDate(year, m, day);
    if (!isBusinessDay(date)) continue;
    found += 1;
    last = date;
    if (found === n) return date;
  }
  if (!last) throw new Error(`Mês sem dia útil: ${month}`);
  return last;
}
