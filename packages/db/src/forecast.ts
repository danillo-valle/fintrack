// As previstas (M13.3c, ADR-027): o que se repete e ainda não chegou e as parcelas que faltam, com
// os nomes, para as telas que olham para a frente:
//
//   forecastItems        cada prevista dos meses pedidos (Cartões, Lançamentos, Fixas e parcelas)
//   knownStatements      o que já chegou nas faturas que vencem nos meses pedidos
//   billPayers           a conta que paga cada cartão (a do último pagamento de fatura)
//   upcoming             a tabela Próximos meses do Início
//   arrivalsVsExpected   o que chegou de uma recorrência do banco e quanto veio diferente
//   cardForecast         as previstas de um cartão no ano que vem, com o ciclo dele
//
// As regras são do @fintrack/core (forecastLines, upcomingItems, expectedAmount); aqui só se lê.
// Fora do cache das somas: os nomes mudam na hora, e as previstas são poucas.
import {
  addMonthsToKey,
  civilFromDbDate,
  dbDateFromCivil,
  expectedAmount,
  firstDayOf,
  forecastLines,
  monthOf,
  dayOfMonth,
  statementDueIn,
  upcomingItems,
  upcomingMonths,
  type CardCycle,
  type CivilDate,
  type ForecastLine,
  type KnownStatement,
  type MonthKey,
  type RecurrenceAmountRule,
  type RecurrenceDayRule,
  type UpcomingMonth,
} from "@fintrack/core";
import type { WalletScope } from "./access";
import { monthAsRange } from "./cash";
import { recurrencePlans } from "./dashboard";
import { Prisma, type PrismaClient } from "./generated/prisma/client";
import { installmentPlans } from "./installments";
import { fromDbDecimal } from "./money";

const NO_WALLET = "00000000-0000-0000-0000-000000000000";
const walletIdsOf = (scope: WalletScope<"view">) =>
  scope.walletIds.length > 0 ? [...scope.walletIds] : [NO_WALLET];

/** Uma prevista com o que a tela escreve dela. */
export type ForecastItem = ForecastLine & {
  /** Uma chave estável da linha (a recorrência ou a compra, e o mês) */
  key: string;
  title: string;
  /** O texto do banco da compra parcelada (a recorrência guarda só o nome) */
  bankText: string | null;
  categoryName: string | null;
  accountName: string;
  /** Na recorrência: a regra do valor e do dia, e o fim */
  rule: {
    origin: "APP" | "BANK";
    amountRule: RecurrenceAmountRule;
    dayRule: RecurrenceDayRule;
    day: number;
    endsOn: CivilDate | null;
  } | null;
};

/**
 * As previstas dos meses pedidos nas carteiras do escopo (forecastLines), com o nome da
 * recorrência ou da compra, a categoria e a conta.
 */
export async function forecastItems(
  db: PrismaClient,
  scope: WalletScope<"view">,
  months: readonly MonthKey[],
  today: CivilDate,
): Promise<ForecastItem[]> {
  if (months.length === 0 || scope.walletIds.length === 0) return [];
  const [plans, installments] = await Promise.all([
    recurrencePlans(db, scope, months),
    installmentPlans(db, scope, today),
  ]);
  const lines = forecastLines(plans, installments, months, today);
  if (lines.length === 0) return [];
  const [recurrences, categories, accounts] = await Promise.all([
    db.recurrence.findMany({
      where: { id: { in: plans.map((p) => p.id) } },
      select: { id: true, description: true },
    }),
    db.category.findMany({
      where: {
        id: { in: [...new Set(lines.flatMap((l) => (l.categoryId ? [l.categoryId] : [])))] },
      },
      select: { id: true, name: true },
    }),
    db.financialAccount.findMany({
      where: { id: { in: [...new Set(lines.map((l) => l.accountId))] } },
      select: { id: true, name: true },
    }),
  ]);
  const recurrenceName = new Map(recurrences.map((r) => [r.id, r.description]));
  const categoryName = new Map(categories.map((c) => [c.id, c.name]));
  const accountName = new Map(accounts.map((a) => [a.id, a.name]));
  const plan = new Map(plans.map((p) => [p.id, p]));
  const installment = new Map(installments.map((i) => [i.key, i]));
  return lines.map((l) => {
    const p = l.source === "recurrence" ? plan.get(l.sourceId) : undefined;
    const i = l.source === "installment" ? installment.get(l.sourceId) : undefined;
    return {
      ...l,
      key: `${l.source}:${l.sourceId}:${l.installment?.number ?? l.date}`,
      title: (p ? recurrenceName.get(l.sourceId) : i?.title) ?? "Prevista",
      bankText: i?.bankText ?? null,
      categoryName: l.categoryId ? (categoryName.get(l.categoryId) ?? null) : null,
      accountName: accountName.get(l.accountId) ?? "Conta",
      rule: p
        ? {
            origin: p.origin,
            amountRule: p.amountRule,
            dayRule: p.dayRule ?? "DAY",
            day: p.dayOfMonth,
            endsOn: p.endsOn,
          }
        : null,
    };
  });
}

type RawKnown = { accountId: string; month: string; amount: Prisma.Decimal };

/**
 * O que já chegou nas faturas que vencem nos meses pedidos, por cartão (positivo = a pagar; o
 * estorno abate). As mesmas regras das somas: sem transferência, sem excluído e sem recebido na
 * revisão (a prevista dele continua).
 */
export async function knownStatements(
  db: PrismaClient,
  scope: WalletScope<"view">,
  months: readonly MonthKey[],
): Promise<(KnownStatement & { accountId: string })[]> {
  if (months.length === 0) return [];
  const sorted = [...months].sort();
  const from = dbDateFromCivil(monthAsRange(sorted[0] as MonthKey).from);
  const to = dbDateFromCivil(monthAsRange(sorted.at(-1) as MonthKey).to);
  const rows = await db.$queryRaw<RawKnown[]>(Prisma.sql`
    SELECT t."accountId"::text AS "accountId",
           to_char(s."dueDate", 'YYYY-MM') AS "month",
           SUM(-t."amount") AS "amount"
    FROM "transaction" t
    JOIN "card_statement" s ON s."id" = t."statementId"
    WHERE t."walletId" = ANY(${walletIdsOf(scope)}::uuid[])
      AND t."deletedAt" IS NULL
      AND t."status" <> 'PENDING'
      AND t."transferId" IS NULL
      AND s."dueDate" BETWEEN ${from}::date AND ${to}::date
    GROUP BY 1, 2
  `);
  return rows.map((r) => ({
    accountId: r.accountId,
    month: r.month,
    amount: fromDbDecimal(r.amount),
  }));
}

type RawPayer = { cardAccountId: string; payingAccountId: string };

/**
 * A conta que paga cada cartão do escopo: a de onde saiu o último pagamento de fatura (a
 * transferência que entrou no cartão, M13.2). Cartão sem pagamento ligado não tem.
 */
export async function billPayers(
  db: PrismaClient,
  scope: WalletScope<"view">,
): Promise<Map<string, string>> {
  const rows = await db.$queryRaw<RawPayer[]>(Prisma.sql`
    SELECT DISTINCT ON (t."accountId")
           t."accountId"::text AS "cardAccountId",
           p."accountId"::text AS "payingAccountId"
    FROM "transaction" t
    JOIN "financial_account" a ON a."id" = t."accountId" AND a."kind" = 'CREDIT_CARD'
    JOIN "transaction" p ON p."transferId" = t."transferId" AND p."accountId" <> t."accountId"
                         AND p."deletedAt" IS NULL
    WHERE t."walletId" = ANY(${walletIdsOf(scope)}::uuid[])
      AND t."transferId" IS NOT NULL
      AND t."deletedAt" IS NULL
      AND t."amount" > 0
    ORDER BY t."accountId", t."occurredOn" DESC, t."id" DESC
  `);
  return new Map(rows.map((r) => [r.cardAccountId, r.payingAccountId]));
}

/** Quantos meses a tabela Próximos meses mostra (a partir do mês que vem). */
export const UPCOMING_MONTHS = 4;

/** Os meses do Próximos meses: os 4 depois do de hoje. */
export function upcomingMonthKeys(today: CivilDate): MonthKey[] {
  return Array.from({ length: UPCOMING_MONTHS }, (_, i) => addMonthsToKey(monthOf(today), i + 1));
}

/**
 * Próximos meses (O-ProximosMeses): por mês, o que entra, as fixas que saem das contas, o que já
 * se sabe das faturas e a sobra antes das variáveis.
 */
export async function upcoming(
  db: PrismaClient,
  scope: WalletScope<"view">,
  today: CivilDate,
): Promise<{ months: UpcomingMonth[]; items: ForecastItem[] }> {
  const months = upcomingMonthKeys(today);
  const [items, known] = await Promise.all([
    forecastItems(db, scope, months, today),
    knownStatements(db, scope, months),
  ]);
  return { months: upcomingMonths(months, upcomingItems(items, known)), items };
}

/** Uma cobrança que chegou ligada a uma recorrência do banco, com o valor que se esperava. */
export type ArrivalVsExpected = {
  transactionId: string;
  recurrenceId: string;
  /** O nome da recorrência */
  title: string;
  occurredOn: CivilDate;
  /** Com sinal */
  amount: bigint;
  expected: bigint;
};

/**
 * O que chegou num mês ligado às recorrências do banco da conta, com o previsto daquele mês (o
 * que se sabia antes dele: expectedAmount com `before`). A tela mostra "chegou R$ 90,00 a menos".
 */
export async function arrivalsVsExpected(
  db: PrismaClient,
  scope: WalletScope<"view">,
  accountId: string,
  month: MonthKey,
): Promise<ArrivalVsExpected[]> {
  const range = monthAsRange(month);
  const recurrences = await db.recurrence.findMany({
    where: {
      walletId: { in: walletIdsOf(scope) },
      accountId,
      origin: "BANK",
      transactions: {
        some: {
          deletedAt: null,
          status: "CONFIRMED",
          occurredOn: { gte: dbDateFromCivil(range.from), lte: dbDateFromCivil(range.to) },
        },
      },
    },
    select: {
      id: true,
      description: true,
      amountRule: true,
      amount: true,
      transactions: {
        where: {
          deletedAt: null,
          status: "CONFIRMED",
          occurredOn: {
            gte: dbDateFromCivil(firstDayOf(addMonthsToKey(month, -4))),
            lte: dbDateFromCivil(range.to),
          },
        },
        orderBy: [{ occurredOn: "asc" }, { id: "asc" }],
        select: { id: true, occurredOn: true, amount: true },
      },
    },
  });
  return recurrences.flatMap((r) => {
    const arrivals = r.transactions.map((t) => ({
      id: t.id,
      occurredOn: civilFromDbDate(t.occurredOn),
      amount: fromDbDecimal(t.amount),
    }));
    const expected = expectedAmount(r.amountRule, fromDbDecimal(r.amount), arrivals, month);
    return arrivals
      .filter((a) => monthOf(a.occurredOn) === month)
      .map((a) => ({
        transactionId: a.id,
        recurrenceId: r.id,
        title: r.description,
        occurredOn: a.occurredOn,
        amount: a.amount,
        expected,
      }));
  });
}

/** Quantos meses à frente Cartões mostra as faturas que ainda não abriram. */
export const CARD_FORECAST_MONTHS = 12;

/**
 * As previstas de um cartão (a conta da fatura), do mês de hoje até um ano depois, e o ciclo dele
 * (as faturas que ainda não existem saem dele: futureStatements). A conta já foi autorizada por
 * quem chama; o escopo limita as carteiras.
 */
export async function cardForecast(
  db: PrismaClient,
  scope: WalletScope<"view">,
  accountId: string,
  today: CivilDate,
): Promise<{ items: ForecastItem[]; cycle: CardCycle | null }> {
  const months = Array.from({ length: CARD_FORECAST_MONTHS }, (_, i) =>
    addMonthsToKey(monthOf(today), i),
  );
  const [items, account] = await Promise.all([
    forecastItems(db, scope, months, today),
    db.financialAccount.findUnique({
      where: { id: accountId },
      select: { closingDay: true, dueDay: true },
    }),
  ]);
  return {
    items: items.filter((i) => i.accountId === accountId),
    cycle:
      account?.closingDay != null && account.dueDay != null
        ? { closingDay: account.closingDay, dueDay: account.dueDay }
        : null,
  };
}

/** Uma fatura que esta conta paga, num mês: o que já chegou nela e as previstas. */
export type BillToPay = {
  cardAccountId: string;
  cardName: string;
  dueDate: CivilDate;
  /** O que já chegou (positivo = a pagar) */
  known: bigint;
  /** As previstas (positivo) */
  forecast: bigint;
};

/** Um mês de uma conta olhando para a frente (O-ContaPrevista). */
export type AccountForecastMonth = {
  month: MonthKey;
  items: ForecastItem[];
  bills: BillToPay[];
};

/**
 * Os meses de uma conta olhando para a frente (M13.3c, ADR-027; prancha O-ContaPrevista): as
 * previstas que entram e saem dela e as faturas dos cartões que ela paga (a do último pagamento,
 * billPayers), com o que já chegou e o previsto delas. A conta já foi autorizada por quem chama.
 */
export async function accountForecast(
  db: PrismaClient,
  scope: WalletScope<"view">,
  accountId: string,
  months: readonly MonthKey[],
  today: CivilDate,
): Promise<AccountForecastMonth[]> {
  if (months.length === 0) return [];
  const [items, payers, known] = await Promise.all([
    forecastItems(db, scope, months, today),
    billPayers(db, scope),
    knownStatements(db, scope, months),
  ]);
  const cardIds = [...payers.entries()].filter(([, payer]) => payer === accountId).map(([c]) => c);
  const cards =
    cardIds.length === 0
      ? []
      : await db.financialAccount.findMany({
          where: { id: { in: cardIds } },
          orderBy: { name: "asc" },
          select: { id: true, name: true, closingDay: true, dueDay: true },
        });
  return months.map((month) => {
    const bills = cards.flatMap((card) => {
      const cardLines = items.filter((i) => i.accountId === card.id && i.month === month);
      const knownAmount = known
        .filter((k) => k.accountId === card.id && k.month === month)
        .reduce((t, k) => t + k.amount, 0n);
      const forecast = cardLines.reduce((t, l) => t - l.amount, 0n);
      if (knownAmount === 0n && forecast === 0n) return [];
      const dueDate =
        cardLines[0]?.cashDate ??
        (card.closingDay !== null && card.dueDay !== null
          ? statementDueIn(month, { closingDay: card.closingDay, dueDay: card.dueDay }).dueDate
          : dayOfMonth(month, 1));
      return [
        { cardAccountId: card.id, cardName: card.name, dueDate, known: knownAmount, forecast },
      ];
    });
    return {
      month,
      items: items.filter((i) => i.accountId === accountId && i.month === month),
      bills,
    };
  });
}
