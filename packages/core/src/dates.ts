// Datas "de calendário" (datas civis): o dia em que algo aconteceu, sem hora e sem fuso.
//
// Por que não usar Date direto: um Date é um INSTANTE (milissegundos desde 1970 em UTC).
// Uma compra feita às 22h do dia 31 em São Paulo já é dia 1º em UTC; se o código guardar
// o instante e depois "pegar o dia" no fuso errado, a compra muda de mês e o orçamento mente.
// Um lançamento não tem hora: tem DIA. Por isso, nas regras do FinTrack, data é texto
// "AAAA-MM-DD" (o formato ISO 8601, que também ordena certo como texto), e mês é "AAAA-MM".
//
// No banco, a coluna é DATE (sem hora). O Prisma entrega um DATE como Date à meia-noite UTC:
// civilFromDbDate e dbDateFromCivil fazem a ponte sem nunca aplicar fuso.

/** Uma data de calendário no formato "AAAA-MM-DD", como "2026-10-02". */
export type CivilDate = string;
/** Um mês no formato "AAAA-MM", como "2026-10". */
export type MonthKey = string;

const CIVIL_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MONTH_RE = /^(\d{4})-(\d{2})$/;

type Parts = { year: number; month: number; day: number };

/** Dias do mês (month de 1 a 12), contando ano bissexto: daysInMonth(2028, 2) = 29. */
export function daysInMonth(year: number, month: number): number {
  // Dia 0 do mês seguinte = último dia deste mês. Date.UTC não sofre com fuso.
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

const pad = (n: number, size = 2) => String(n).padStart(size, "0");

/** Monta a data a partir das partes, conferindo se ela existe: civilDate(2026, 2, 30) falha. */
export function civilDate(year: number, month: number, day: number): CivilDate {
  if (!Number.isInteger(year) || year < 1900 || year > 9999)
    throw new Error(`Ano inválido: ${year}`);
  if (!Number.isInteger(month) || month < 1 || month > 12)
    throw new Error(`Mês inválido: ${month}`);
  if (!Number.isInteger(day) || day < 1 || day > daysInMonth(year, month)) {
    throw new Error(`Dia inválido: ${year}-${pad(month)}-${day}`);
  }
  return `${pad(year, 4)}-${pad(month)}-${pad(day)}`;
}

/** Separa "2026-10-02" em { year: 2026, month: 10, day: 2 }, recusando datas que não existem. */
export function parseCivilDate(value: CivilDate): Parts {
  const match = CIVIL_RE.exec(value);
  if (!match) throw new Error(`Data inválida (use AAAA-MM-DD): "${value}"`);
  const [year, month, day] = match.slice(1).map((part) => Number.parseInt(part, 10)) as [
    number,
    number,
    number,
  ];
  civilDate(year, month, day); // confere se existe (31 de abril não existe)
  return { year, month, day };
}

/** true se o texto é uma data AAAA-MM-DD que existe no calendário. */
export function isCivilDate(value: string): boolean {
  try {
    parseCivilDate(value);
    return true;
  } catch {
    return false;
  }
}

/** Separa "2026-10" em { year: 2026, month: 10 }. */
export function parseMonthKey(value: MonthKey): { year: number; month: number } {
  const match = MONTH_RE.exec(value);
  const year = match ? Number.parseInt(match[1] ?? "", 10) : Number.NaN;
  const month = match ? Number.parseInt(match[2] ?? "", 10) : Number.NaN;
  if (!match || month < 1 || month > 12) throw new Error(`Mês inválido (use AAAA-MM): "${value}"`);
  return { year, month };
}

/** Monta o mês: monthKey(2026, 1) = "2026-01". */
export function monthKey(year: number, month: number): MonthKey {
  return civilDate(year, month, 1).slice(0, 7);
}

/** Mês de uma data: monthOf("2026-10-02") = "2026-10". */
export function monthOf(date: CivilDate): MonthKey {
  parseCivilDate(date);
  return date.slice(0, 7);
}

/** Soma (ou subtrai) meses de um mês: addMonthsToKey("2026-11", 3) = "2027-02". */
export function addMonthsToKey(key: MonthKey, months: number): MonthKey {
  const { year, month } = parseMonthKey(key);
  const index = year * 12 + (month - 1) + months; // meses contados desde o ano 0
  return monthKey(Math.floor(index / 12), (index % 12) + 1);
}

/**
 * Dia `day` do mês, encostando no último dia quando o mês é mais curto:
 * dayOfMonth("2026-02", 31) = "2026-02-28". É assim que vencimentos "todo dia 31" funcionam.
 */
export function dayOfMonth(key: MonthKey, day: number): CivilDate {
  const { year, month } = parseMonthKey(key);
  return civilDate(year, month, Math.min(day, daysInMonth(year, month)));
}

/** Primeiro dia do mês: firstDayOf("2026-10") = "2026-10-01". */
export function firstDayOf(key: MonthKey): CivilDate {
  return dayOfMonth(key, 1);
}

/**
 * Soma meses a uma data, mantendo o dia quando possível:
 * addMonths("2026-01-31", 1) = "2026-02-28" (fevereiro não tem 31).
 */
export function addMonths(date: CivilDate, months: number): CivilDate {
  const { day } = parseCivilDate(date);
  return dayOfMonth(addMonthsToKey(monthOf(date), months), day);
}

/** Soma (ou subtrai) dias: addDays("2026-12-31", 1) = "2027-01-01". */
export function addDays(date: CivilDate, days: number): CivilDate {
  const { year, month, day } = parseCivilDate(date);
  const moved = new Date(Date.UTC(year, month - 1, day + days));
  return civilDate(moved.getUTCFullYear(), moved.getUTCMonth() + 1, moved.getUTCDate());
}

/** Dias entre duas datas (b - a): daysBetween("2026-10-01", "2026-10-31") = 30. */
export function daysBetween(a: CivilDate, b: CivilDate): number {
  const pa = parseCivilDate(a);
  const pb = parseCivilDate(b);
  const ms = Date.UTC(pb.year, pb.month - 1, pb.day) - Date.UTC(pa.year, pa.month - 1, pa.day);
  return ms / 86_400_000;
}

/** Compara duas datas: negativo se a vem antes, zero se iguais, positivo se depois. */
export function compareCivil(a: CivilDate, b: CivilDate): number {
  return a < b ? -1 : a > b ? 1 : 0; // AAAA-MM-DD ordena certo como texto
}

/** Data de hoje num fuso (padrão: São Paulo). O formato en-CA do Intl é AAAA-MM-DD. */
export function todayCivil(now: Date = new Date(), timeZone = "America/Sao_Paulo"): CivilDate {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** Converte a data civil no Date que o Prisma grava numa coluna DATE (meia-noite UTC). */
export function dbDateFromCivil(date: CivilDate): Date {
  const { year, month, day } = parseCivilDate(date);
  return new Date(Date.UTC(year, month - 1, day));
}

/** Converte o Date que o Prisma lê de uma coluna DATE de volta para "AAAA-MM-DD". */
export function civilFromDbDate(value: Date): CivilDate {
  // Os campos UTC são os que o banco gravou; os locais dependeriam do fuso do servidor.
  return civilDate(value.getUTCFullYear(), value.getUTCMonth() + 1, value.getUTCDate());
}
