// Datas no FinTrack.
// Regra: guardar sempre em UTC; mostrar sempre no fuso de São Paulo.
// Um lançamento às 22h do dia 31 em Brasília já é dia 1º em UTC; sem o fuso, ele cairia no mês errado.

export const APP_TIME_ZONE = "America/Sao_Paulo";
export const APP_LOCALE = "pt-BR";

const dayFormat = new Intl.DateTimeFormat(APP_LOCALE, {
  timeZone: APP_TIME_ZONE,
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

const longFormat = new Intl.DateTimeFormat(APP_LOCALE, {
  timeZone: APP_TIME_ZONE,
  day: "numeric",
  month: "long",
  year: "numeric",
});

const monthFormat = new Intl.DateTimeFormat(APP_LOCALE, {
  timeZone: APP_TIME_ZONE,
  month: "long",
  year: "numeric",
});

// en-CA formata como AAAA-MM-DD, o formato do <input type="date">
const isoDayFormat = new Intl.DateTimeFormat("en-CA", {
  timeZone: APP_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** 01/10/2026 */
export function formatDate(date: Date): string {
  return dayFormat.format(date);
}

/** 1 de outubro de 2026 */
export function formatDateLong(date: Date): string {
  return longFormat.format(date);
}

/** outubro de 2026 */
export function formatMonth(date: Date): string {
  return monthFormat.format(date);
}

/** Data de hoje em São Paulo, no formato AAAA-MM-DD */
export function todayISO(now: Date = new Date()): string {
  return isoDayFormat.format(now);
}
