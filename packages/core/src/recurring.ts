// O que se repete nos próximos meses (M13.3c, ADR-027): a fixa e o salário que o banco traz todo
// mês, e as parcelas que ainda vão cair. Regras puras; o banco só lê e soma.
//
//   seriesKey           a chave do comerciante que liga a cobrança que chega à recorrência dela
//   expectedAmount      o valor previsto: o último, a média de 3 meses ou o gravado
//   projectedInstallments  as parcelas que faltam de cada compra parcelada do banco
//   forecastState       prevista, ou "não chegou" depois do dia
//   upcomingMonths      a tabela do Início: entra, fixas da conta, fatura e a sobra
//   recurrenceSettingsValid  o valor e o dia que a pessoa escolhe (Repete todo mês, Mudar o valor)
//   forecastLines       cada prevista dos meses pedidos: a da recorrência e a parcela que falta
//   upcomingItems       as previstas e o que já está nas faturas, nas partes do Próximos meses
import { divRound } from "./budget";
import { pendingOccurrences, type ScheduledRecurrence } from "./cashflow";
import { matchText, merchantKey } from "./categorization";
import {
  addMonthsToKey,
  compareCivil,
  dayOfMonth,
  monthOf,
  parseCivilDate,
  type CivilDate,
  type MonthKey,
} from "./dates";
import type { InstallmentParcel } from "./installment-progress";
import type { AccountKind, RecurrenceDayRule } from "./transactions";
import { sumCents, type Cents } from "./money";

/** Quem traz o lançamento de uma recorrência: o FinTrack gera, ou o banco traz e ela só prevê. */
export type RecurrenceOrigin = "APP" | "BANK";
/** O valor previsto: o gravado, o último que chegou ou a média dos últimos 3 meses. */
export type RecurrenceAmountRule = "FIXED" | "LAST" | "AVERAGE_3";

export const RECURRENCE_AMOUNT_RULES: readonly RecurrenceAmountRule[] = [
  "LAST",
  "AVERAGE_3",
  "FIXED",
];

/** O tamanho máximo da chave do comerciante (o CHECK do banco). */
export const SERIES_KEY_MAX = 100;

/**
 * A chave que diz "a mesma cobrança" de um mês para o outro: o comerciante do texto do banco
 * (merchantKey), ou o texto inteiro quando ele não tem palavra que identifique.
 */
export function seriesKey(description: string): string {
  const key =
    merchantKey(description) || matchText(description) || description.trim().toLowerCase();
  return key.slice(0, SERIES_KEY_MAX);
}

/** Uma cobrança que chegou e foi ligada à recorrência (com sinal). */
export type Arrival = { occurredOn: CivilDate; amount: Cents };

/** O total de cada mês que chegou, do mais recente para o mais antigo. */
function monthlyTotals(arrivals: readonly Arrival[]): Cents[] {
  const byMonth = new Map<MonthKey, Cents>();
  for (const a of arrivals) {
    const month = monthOf(a.occurredOn);
    byMonth.set(month, (byMonth.get(month) ?? 0n) + a.amount);
  }
  return [...byMonth.entries()]
    .toSorted(([a], [b]) => (a < b ? 1 : a > b ? -1 : 0))
    .map(([, total]) => total);
}

/**
 * O valor previsto de uma recorrência (com sinal). Só as cobranças de antes de `before` contam
 * (o previsto de um mês é o que se sabia antes dele); sem nenhuma, o valor gravado.
 */
export function expectedAmount(
  rule: RecurrenceAmountRule,
  fixed: Cents,
  arrivals: readonly Arrival[],
  before: MonthKey | null = null,
): Cents {
  if (rule === "FIXED") return fixed;
  const known = before ? arrivals.filter((a) => monthOf(a.occurredOn) < before) : arrivals;
  const totals = monthlyTotals(known);
  if (totals.length === 0) return fixed;
  if (rule === "LAST") return totals[0] as Cents;
  const last3 = totals.slice(0, 3);
  return divRound(sumCents(last3), BigInt(last3.length));
}

/** Uma parcela prevista: a compra, o número, o total, o valor e o vencimento da fatura dela. */
export type ProjectedInstallment = {
  key: string;
  number: number;
  count: number;
  /** Com sinal (a compra é negativa) */
  amount: Cents;
  dueDate: CivilDate;
  /** O mês em que conta (o do vencimento, ADR-025) */
  month: MonthKey;
};

/**
 * As parcelas que faltam de cada compra parcelada do banco: depois da parcela mais recente que
 * chegou (k de n), a k+1 na fatura seguinte, e assim até a n, pelo valor da parcela.
 */
export function projectedInstallments(
  parcels: readonly InstallmentParcel[],
): ProjectedInstallment[] {
  const latest = new Map<string, InstallmentParcel>();
  for (const p of parcels) {
    const seen = latest.get(p.key);
    if (!seen || p.number > seen.number) latest.set(p.key, p);
  }
  const result: ProjectedInstallment[] = [];
  for (const p of latest.values()) {
    const dueDay = parseCivilDate(p.dueDate).day;
    for (let number = p.number + 1, i = 1; number <= p.count; number += 1, i += 1) {
      const month = addMonthsToKey(monthOf(p.dueDate), i);
      result.push({
        key: p.key,
        number,
        count: p.count,
        amount: p.amount,
        dueDate: dayOfMonth(month, dueDay),
        month,
      });
    }
  }
  return result.toSorted(
    (a, b) => compareCivil(a.dueDate, b.dueDate) || a.key.localeCompare(b.key),
  );
}

/** Prevista, ou "não chegou" quando o dia dela já passou. */
export type ForecastState = "expected" | "late";

export function forecastState(date: CivilDate, today: CivilDate): ForecastState {
  return compareCivil(date, today) < 0 ? "late" : "expected";
}

/** Uma linha da tabela Próximos meses (valores positivos). */
export type UpcomingItem = {
  month: MonthKey;
  /** income: entra; account: fixa que sai da conta; card: o que já se sabe da fatura do cartão */
  part: "income" | "account" | "card";
  amount: Cents;
};

export type UpcomingMonth = {
  month: MonthKey;
  income: Cents;
  account: Cents;
  card: Cents;
  /** O que sobra antes das variáveis: entra − fixas da conta − fatura */
  left: Cents;
};

/** Os meses da tabela Próximos meses, na ordem pedida (o que cai fora deles é ignorado). */
export function upcomingMonths(
  months: readonly MonthKey[],
  items: readonly UpcomingItem[],
): UpcomingMonth[] {
  return months.map((month) => {
    const of = (part: UpcomingItem["part"]) =>
      sumCents(items.filter((i) => i.month === month && i.part === part).map((i) => i.amount));
    const income = of("income");
    const account = of("account");
    const card = of("card");
    return { month, income, account, card, left: income - account - card };
  });
}

/** O maior "N-ésimo dia útil" (o CHECK do banco; num mês com menos, vale o último dia útil). */
export const BUSINESS_DAY_MAX = 23;

/** O valor e o dia de uma recorrência, como a pessoa escolhe. */
export type RecurrenceSettings = {
  amountRule: RecurrenceAmountRule;
  /** O valor fixo, positivo (o tipo dá o sinal); só com a regra FIXED */
  fixed: Cents | null;
  dayRule: RecurrenceDayRule;
  /** O dia do mês (1 a 31) ou o N-ésimo dia útil (1 a 23) */
  day: number;
  /** O último dia (nulo = sem data para acabar) */
  endsOn: CivilDate | null;
};

/**
 * true se o valor e o dia valem (os mesmos limites dos CHECKs): a do app só tem valor fixo (ela
 * gera o lançamento, ADR-027); valor fixo maior que zero; o dia de 1 a 31, o dia útil de 1 a 23; o
 * fim depois do início.
 */
export function recurrenceSettingsValid(
  origin: RecurrenceOrigin,
  startsOn: CivilDate,
  s: RecurrenceSettings,
): boolean {
  if (origin === "APP" && s.amountRule !== "FIXED") return false;
  if (s.amountRule === "FIXED" ? s.fixed === null || s.fixed <= 0n : s.fixed !== null) return false;
  const maxDay = s.dayRule === "BUSINESS_DAY" ? BUSINESS_DAY_MAX : 31;
  if (!Number.isInteger(s.day) || s.day < 1 || s.day > maxDay) return false;
  return s.endsOn === null || compareCivil(s.endsOn, startsOn) >= 0;
}

/** O que o previsto precisa saber de quem paga e de quem é (o mesmo do lançamento). */
type Owner = {
  walletId: string;
  accountId: string;
  categoryId: string | null;
  /** "Pago por" (o parâmetro da URL: o id da pessoa ou "compartilhado") */
  payer: string | null;
};

/** Uma recorrência ativa, pronta para prever (o valor já é o previsto, com sinal). */
export type ForecastRecurrence = ScheduledRecurrence & Owner;

/** Uma parcela que ainda vai cair, com a conta. */
export type ForecastInstallment = ProjectedInstallment & Owner & { accountKind: AccountKind };

/** Uma prevista: o que se repete e ainda não chegou, ou a parcela que falta. */
export type ForecastLine = Owner & {
  source: "recurrence" | "installment";
  /** A recorrência, ou a chave da compra parcelada */
  sourceId: string;
  accountKind: AccountKind;
  /** O dia em que ela deve acontecer (a parcela: o vencimento da fatura) */
  date: CivilDate;
  /** O dia em que o dinheiro sai ou entra (no cartão, o vencimento da fatura, ADR-025) */
  cashDate: CivilDate;
  /** O mês em que conta (o da data de caixa) */
  month: MonthKey;
  /** Com sinal */
  amount: Cents;
  installment: { number: number; count: number } | null;
  state: ForecastState;
};

/**
 * As previstas dos meses pedidos (ADR-027): cada ocorrência das recorrências que ainda não chegou
 * (pendingOccurrences: a do app que não foi gerada, a do banco sem a cobrança conferida) e cada
 * parcela que falta das compras parceladas. Ordenadas pelo dia de caixa.
 */
export function forecastLines(
  recurrences: readonly (ForecastRecurrence & { id: string })[],
  installments: readonly ForecastInstallment[],
  months: readonly MonthKey[],
  today: CivilDate,
): ForecastLine[] {
  const wanted = new Set(months);
  const lines: ForecastLine[] = [];
  for (const r of recurrences) {
    for (const o of pendingOccurrences(r, months, today)) {
      lines.push({
        walletId: r.walletId,
        accountId: r.accountId,
        categoryId: r.categoryId,
        payer: r.payer,
        source: "recurrence",
        sourceId: r.id,
        accountKind: r.account.kind,
        date: o.date,
        cashDate: o.cashDate,
        month: o.month,
        amount: r.amount,
        installment: null,
        state: forecastState(o.date, today),
      });
    }
  }
  for (const p of installments) {
    if (!wanted.has(p.month)) continue;
    lines.push({
      walletId: p.walletId,
      accountId: p.accountId,
      categoryId: p.categoryId,
      payer: p.payer,
      source: "installment",
      sourceId: p.key,
      accountKind: p.accountKind,
      date: p.dueDate,
      cashDate: p.dueDate,
      month: p.month,
      amount: p.amount,
      installment: { number: p.number, count: p.count },
      state: forecastState(p.dueDate, today),
    });
  }
  return lines.toSorted(
    (a, b) => compareCivil(a.cashDate, b.cashDate) || a.sourceId.localeCompare(b.sourceId),
  );
}

/** O que já está numa fatura (compras que chegaram), somado por mês do vencimento (positivo). */
export type KnownStatement = { month: MonthKey; amount: Cents };

/**
 * As partes do Próximos meses: no cartão, o que já se sabe da fatura (as previstas e o que já
 * chegou nela); fora do cartão, a entrada prevista e a fixa que sai da conta. A entrada no cartão
 * (estorno previsto não existe) não entra.
 */
export function upcomingItems(
  lines: readonly ForecastLine[],
  known: readonly KnownStatement[],
): UpcomingItem[] {
  const items: UpcomingItem[] = known.map((k) => ({
    month: k.month,
    part: "card",
    amount: k.amount,
  }));
  for (const l of lines) {
    if (l.accountKind === "CREDIT_CARD") {
      if (l.amount < 0n) items.push({ month: l.month, part: "card", amount: -l.amount });
    } else if (l.amount > 0n) {
      items.push({ month: l.month, part: "income", amount: l.amount });
    } else {
      items.push({ month: l.month, part: "account", amount: -l.amount });
    }
  }
  return items;
}
