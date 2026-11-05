// Agregações do painel, do orçamento e do fluxo de caixa (M08). O banco SOMA; o @fintrack/core
// decide o que os números querem dizer (previsto, média, orçado × realizado).
//
// Todas partem de um escopo (WalletScope<"view">): só as carteiras que a pessoa vê. As somas
// seguem as mesmas regras da lista de lançamentos (sem transferências, sem excluídos), por isso
// todo número do painel leva a uma lista com o mesmo total.
//
// "Pago por" aqui é a mesma regra do resolvePayer (core) e do payerWhere (transactions.ts),
// escrita em SQL. O teste de integração confere, lançamento por lançamento, que as três
// concordam.
import {
  ACCOUNTS_WINDOW,
  addMonthsToKey,
  expectedAmount,
  civilFromDbDate,
  dbDateFromCivil,
  firstDayOf,
  dayOfMonth,
  resolvePayer,
  SHARED_PAYER_PARAM,
  statementWindow,
  type AccountKind,
  type CivilDate,
  type FixedCharge,
  type MonthKey,
  type NewRecurrence,
  type PaceWindow,
  type ForecastRecurrence,
  type RecurrenceAmountRule,
  type RecurrenceOrigin,
  type SpendingNature,
  type SpendingRow,
} from "@fintrack/core";
import type { WalletScope } from "./access";
import { CASH_JOINS_SQL, CASH_ON_SQL, EXPENSE_SQL, INCOME_SQL } from "./cash";
import { Prisma, type PrismaClient } from "./generated/prisma/client";
import { fromDbDecimal } from "./money";
import { NATURE_SQL } from "./nature";

const NO_WALLET = "00000000-0000-0000-0000-000000000000";

/** As carteiras do escopo como parâmetro do SQL (nunca vazio: um id que não existe). */
const walletIdsOf = (scope: WalletScope<"view">) =>
  scope.walletIds.length > 0 ? [...scope.walletIds] : [NO_WALLET];

/** A regra de quem pagou (resolvePayer), em SQL. "t", "a" e "c": lançamento, conta e cartão. */
const PAYER_SQL = Prisma.sql`CASE
    WHEN c."sharedPurchases" THEN ${SHARED_PAYER_PARAM}
    WHEN t."cardId" IS NOT NULL THEN c."holderId"
    ELSE a."holderId"
  END`;

type RawSpending = {
  month: string;
  window: string;
  walletId: string;
  categoryId: string | null;
  payer: string | null;
  nature: SpendingNature;
  upToToday: boolean;
  expense: Prisma.Decimal;
  income: Prisma.Decimal;
  firstAfterToday: Date | null;
};

/**
 * O gasto e as entradas que contam de `from` a `to` (meses, inclusive), somados por mês, janela,
 * ambiente, categoria, quem pagou, natureza e "aconteceu até hoje ou depois". O mês é o da data de
 * caixa (ADR-025): no cartão, o do vencimento da fatura. A janela é a fatura (o ritmo de cada
 * cartão) ou ACCOUNTS_WINDOW. Entrada e saída pela regra flowOf: no cartão, o estorno abate a
 * saída. Uma consulta só: o período começa dois meses antes na data da compra (uma compra no
 * cartão conta até dois meses depois) e a data de caixa filtra o resto.
 */
export async function spendingRows(
  db: PrismaClient,
  scope: WalletScope<"view">,
  input: { from: MonthKey; to: MonthKey; today: CivilDate },
): Promise<SpendingRow[]> {
  const from = dbDateFromCivil(firstDayOf(input.from));
  const to = dbDateFromCivil(dayOfMonth(input.to, 31));
  const today = dbDateFromCivil(input.today);
  const rows = await db.$queryRaw<RawSpending[]>(Prisma.sql`
    SELECT
      to_char(${CASH_ON_SQL}, 'YYYY-MM') AS "month",
      COALESCE(t."statementId"::text, ${ACCOUNTS_WINDOW}) AS "window",
      t."walletId"::text AS "walletId",
      t."categoryId"::text AS "categoryId",
      ${PAYER_SQL} AS "payer",
      ${NATURE_SQL} AS "nature",
      (t."occurredOn" <= ${today}::date) AS "upToToday",
      COALESCE(SUM(${EXPENSE_SQL}), 0) AS "expense",
      COALESCE(SUM(${INCOME_SQL}), 0) AS "income",
      MIN(t."occurredOn") FILTER (WHERE ${EXPENSE_SQL} > 0 AND t."occurredOn" > ${today}::date)
        AS "firstAfterToday"
    FROM "transaction" t
    ${CASH_JOINS_SQL}
    LEFT JOIN "payment_card" c ON c."id" = t."cardId"
    WHERE t."walletId" = ANY(${walletIdsOf(scope)}::uuid[])
      AND t."deletedAt" IS NULL
      AND t."status" <> 'PENDING' -- recebido do banco: fora das somas até a revisão (ADR-011)
      AND t."transferId" IS NULL
      AND t."occurredOn" BETWEEN (${from}::date - interval '2 months')::date AND ${to}::date
      AND ${CASH_ON_SQL} BETWEEN ${from}::date AND ${to}::date
    GROUP BY 1, 2, 3, 4, 5, 6, 7
  `);
  return rows.map((r) => ({
    month: r.month,
    window: r.window,
    walletId: r.walletId,
    categoryId: r.categoryId,
    payer: r.payer,
    nature: r.nature,
    upToToday: r.upToToday,
    expense: fromDbDecimal(r.expense),
    income: fromDbDecimal(r.income),
    firstAfterToday: r.firstAfterToday ? civilFromDbDate(r.firstAfterToday) : null,
  }));
}

type RawFixedCharge = {
  month: string;
  cashOn: Date;
  walletId: string;
  categoryId: string | null;
  payer: string | null;
  description: string;
  label: string | null;
  recurrenceId: string | null;
  expense: Prisma.Decimal;
};

/**
 * As saídas fixas (NATURE_SQL) do mês passado e de `month`, uma por lançamento, para o previsto
 * contar cada fixa uma vez (missingFixedCharges, ADR-026). As mesmas regras das somas: data de
 * caixa, sem transferência, sem excluído e sem recebido ainda na revisão.
 */
export async function fixedCharges(
  db: PrismaClient,
  scope: WalletScope<"view">,
  month: MonthKey,
): Promise<FixedCharge[]> {
  const from = dbDateFromCivil(firstDayOf(addMonthsToKey(month, -1)));
  const to = dbDateFromCivil(dayOfMonth(month, 31));
  const rows = await db.$queryRaw<RawFixedCharge[]>(Prisma.sql`
    SELECT
      to_char(${CASH_ON_SQL}, 'YYYY-MM') AS "month",
      ${CASH_ON_SQL} AS "cashOn",
      t."walletId"::text AS "walletId",
      t."categoryId"::text AS "categoryId",
      ${PAYER_SQL} AS "payer",
      t."description" AS "description",
      t."label" AS "label",
      t."recurrenceId"::text AS "recurrenceId",
      ${EXPENSE_SQL} AS "expense"
    FROM "transaction" t
    ${CASH_JOINS_SQL}
    LEFT JOIN "payment_card" c ON c."id" = t."cardId"
    WHERE t."walletId" = ANY(${walletIdsOf(scope)}::uuid[])
      AND t."deletedAt" IS NULL
      AND t."status" <> 'PENDING' -- recebido do banco: fora das somas até a revisão (ADR-011)
      AND t."transferId" IS NULL
      AND t."occurredOn" BETWEEN (${from}::date - interval '2 months')::date AND ${to}::date
      AND ${CASH_ON_SQL} BETWEEN ${from}::date AND ${to}::date
      AND ${NATURE_SQL} = 'fixed'
      AND ${EXPENSE_SQL} > 0
  `);
  return rows.map((r) => ({
    month: r.month,
    cashOn: civilFromDbDate(r.cashOn),
    walletId: r.walletId,
    categoryId: r.categoryId,
    payer: r.payer,
    description: r.description,
    label: r.label,
    recurrenceId: r.recurrenceId,
    expense: fromDbDecimal(r.expense),
  }));
}

type RawWindow = { id: string; closingDate: Date; previousClosingDate: Date | null };

/**
 * O período de compras de cada fatura (statementWindow do core), para o ritmo do mês (ADR-025):
 * do fechamento da fatura anterior gravada ao dia antes do fechamento dela.
 */
export async function statementWindows(
  db: PrismaClient,
  statementIds: readonly string[],
): Promise<Map<string, PaceWindow>> {
  if (statementIds.length === 0) return new Map();
  const rows = await db.$queryRaw<RawWindow[]>(Prisma.sql`
    SELECT
      s."id"::text AS "id",
      s."closingDate" AS "closingDate",
      (SELECT max(p."closingDate") FROM "card_statement" p
        WHERE p."accountId" = s."accountId" AND p."closingDate" < s."closingDate")
        AS "previousClosingDate"
    FROM "card_statement" s
    WHERE s."id" = ANY(${[...statementIds]}::uuid[])
  `);
  return new Map(
    rows.map((r) => [
      r.id,
      statementWindow({
        closingDate: civilFromDbDate(r.closingDate),
        previousClosingDate: r.previousClosingDate ? civilFromDbDate(r.previousClosingDate) : null,
      }),
    ]),
  );
}

/** Uma recorrência do escopo, pronta para virar previsão (orçamento, fluxo de caixa, previstas). */
export type RecurrencePlan = ForecastRecurrence & {
  id: string;
  /** Quem traz o lançamento (ADR-027): o FinTrack gera ou o banco traz */
  origin: RecurrenceOrigin;
  amountRule: RecurrenceAmountRule;
  cardId: string | null;
};

/** Quantos meses de cobranças a recorrência do banco olha para o valor previsto (a média de 3). */
const ARRIVAL_MONTHS = 4;

/**
 * As recorrências ativas do escopo, com o valor previsto e os meses já realizados (ADR-027):
 *   APP   o mês em que ela já gerou lançamento. Gerado e depois excluído também conta: quem
 *         excluiu decidiu que aquele mês não acontece, e "Lançar as deste mês" não o recria
 *   BANK  o mês com uma cobrança ligada CONFIRMADA e não excluída (o recebido ainda na revisão está
 *         fora das somas, e a prevista continua). O valor vem das cobranças (expectedAmount)
 */
export async function recurrencePlans(
  db: PrismaClient,
  scope: WalletScope<"view">,
  months: readonly MonthKey[],
): Promise<RecurrencePlan[]> {
  if (months.length === 0) return [];
  const first = addMonthsToKey(months[0] as MonthKey, -ARRIVAL_MONTHS);
  const recurrences = await db.recurrence.findMany({
    where: { walletId: { in: walletIdsOf(scope) }, archivedAt: null },
    orderBy: { id: "asc" },
    select: {
      id: true,
      walletId: true,
      categoryId: true,
      accountId: true,
      cardId: true,
      amount: true,
      origin: true,
      amountRule: true,
      dayRule: true,
      dayOfMonth: true,
      startsOn: true,
      endsOn: true,
      account: { select: { kind: true, holderId: true, closingDay: true, dueDay: true } },
      card: { select: { holderId: true, sharedPurchases: true } },
      transactions: {
        where: {
          occurredOn: {
            gte: dbDateFromCivil(firstDayOf(first)),
            lte: dbDateFromCivil(dayOfMonth(months.at(-1) as MonthKey, 31)),
          },
        },
        select: { occurredOn: true, amount: true, status: true, deletedAt: true },
      },
    },
  });
  return recurrences.map((r) => {
    const payer = resolvePayer({ card: r.card, account: r.account });
    const arrived = r.transactions.filter((t) => t.status === "CONFIRMED" && t.deletedAt === null);
    const realized = r.origin === "BANK" ? arrived : r.transactions;
    const fixed = fromDbDecimal(r.amount);
    return {
      id: r.id,
      walletId: r.walletId,
      categoryId: r.categoryId,
      accountId: r.accountId,
      cardId: r.cardId,
      origin: r.origin,
      amountRule: r.amountRule,
      payer:
        payer.kind === "shared"
          ? SHARED_PAYER_PARAM
          : payer.kind === "person"
            ? payer.userId
            : null,
      amount:
        r.origin === "BANK"
          ? expectedAmount(
              r.amountRule,
              fixed,
              arrived.map((t) => ({
                occurredOn: civilFromDbDate(t.occurredOn),
                amount: fromDbDecimal(t.amount),
              })),
            )
          : fixed,
      dayOfMonth: r.dayOfMonth,
      dayRule: r.dayRule,
      startsOn: civilFromDbDate(r.startsOn),
      endsOn: r.endsOn ? civilFromDbDate(r.endsOn) : null,
      materialized: new Set(realized.map((t) => civilFromDbDate(t.occurredOn).slice(0, 7))),
      account: {
        kind: r.account.kind,
        cycle:
          r.account.closingDay !== null && r.account.dueDay !== null
            ? { closingDay: r.account.closingDay, dueDay: r.account.dueDay }
            : null,
      },
    };
  });
}

/**
 * Os nomes das recorrências ativas do escopo (o "faltam o aluguel e a escola" do previsto, ADR-026).
 * Fora do cache das somas: renomear aparece na hora.
 */
export async function recurrenceNames(
  db: PrismaClient,
  scope: WalletScope<"view">,
): Promise<Map<string, string>> {
  const rows = await db.recurrence.findMany({
    where: { walletId: { in: walletIdsOf(scope) }, archivedAt: null },
    select: { id: true, description: true },
  });
  return new Map(rows.map((r) => [r.id, r.description]));
}

type RawCash = {
  cashOn: Date;
  accountId: string;
  accountName: string;
  kind: AccountKind;
  fromRecurrence: boolean;
  amount: Prisma.Decimal;
};

/** Um grupo de lançamentos com o que o fluxo de caixa precisa (data de caixa, conta, sinal). */
export type CashRow = {
  /** A data de caixa (ADR-025): o dia, ou o vencimento da fatura no cartão */
  cashOn: CivilDate;
  accountId: string;
  accountName: string;
  accountKind: AccountKind;
  fromRecurrence: boolean;
  /** Soma com sinal (entradas e saídas separadas pela regra flowOf: uma linha para cada) */
  amount: bigint;
};

/**
 * Os lançamentos cujo dinheiro se mexe entre `from` e `to` (datas de caixa). Somados por dia,
 * conta, origem e entrada/saída (o fluxo não precisa de cada compra; a lista mostra cada uma). No
 * cartão, tudo é saída: o estorno diminui a fatura.
 */
export async function cashRows(
  db: PrismaClient,
  scope: WalletScope<"view">,
  from: CivilDate,
  to: CivilDate,
): Promise<CashRow[]> {
  const rows = await db.$queryRaw<RawCash[]>(Prisma.sql`
    SELECT
      ${CASH_ON_SQL} AS "cashOn",
      t."accountId"::text AS "accountId",
      a."name" AS "accountName",
      a."kind"::text AS "kind",
      (t."recurrenceId" IS NOT NULL) AS "fromRecurrence",
      SUM(t."amount") AS "amount"
    FROM "transaction" t
    ${CASH_JOINS_SQL}
    WHERE t."walletId" = ANY(${walletIdsOf(scope)}::uuid[])
      AND t."deletedAt" IS NULL
      AND t."status" <> 'PENDING' -- recebido do banco: fora das somas até a revisão (ADR-011)
      AND t."transferId" IS NULL
      AND t."occurredOn" BETWEEN (${dbDateFromCivil(from)}::date - interval '2 months')::date
                             AND ${dbDateFromCivil(to)}::date
      AND ${CASH_ON_SQL} BETWEEN ${dbDateFromCivil(from)}::date AND ${dbDateFromCivil(to)}::date
    GROUP BY 1, 2, 3, 4, 5, (${INCOME_SQL} > 0)
  `);
  return rows.map((r) => ({
    cashOn: civilFromDbDate(r.cashOn),
    accountId: r.accountId,
    accountName: r.accountName,
    accountKind: r.kind,
    fromRecurrence: r.fromRecurrence,
    amount: fromDbDecimal(r.amount),
  }));
}

/** O nome e o tipo das contas do escopo (para o detalhe do fluxo de caixa). */
export async function scopeAccounts(db: PrismaClient, scope: WalletScope<"view">) {
  return db.financialAccount.findMany({
    where: { walletId: { in: walletIdsOf(scope) } },
    orderBy: { name: "asc" },
    select: { id: true, name: true, kind: true, closingDay: true, dueDay: true, walletId: true },
  });
}

/**
 * O resumo do mês (M10.3): as contas fixas e assinaturas de despesa do escopo que começaram no
 * mês. Arquivadas não entram (quem arquivou desistiu dela).
 */
export async function recurrencesStartedIn(
  db: PrismaClient,
  scope: WalletScope<"view">,
  month: MonthKey,
): Promise<NewRecurrence[]> {
  const recurrences = await db.recurrence.findMany({
    where: {
      walletId: { in: walletIdsOf(scope) },
      archivedAt: null,
      kind: { in: ["FIXED_BILL", "SUBSCRIPTION"] },
      amount: { lt: 0 },
      startsOn: {
        gte: dbDateFromCivil(firstDayOf(month)),
        lte: dbDateFromCivil(dayOfMonth(month, 31)),
      },
    },
    orderBy: [{ startsOn: "asc" }, { id: "asc" }],
    select: {
      id: true,
      kind: true,
      walletId: true,
      categoryId: true,
      description: true,
      amount: true,
      startsOn: true,
    },
  });
  return recurrences.map((r) => ({
    id: r.id,
    kind: r.kind === "SUBSCRIPTION" ? "SUBSCRIPTION" : "FIXED_BILL",
    walletId: r.walletId,
    categoryId: r.categoryId,
    description: r.description,
    monthly: -fromDbDecimal(r.amount),
    startsOn: civilFromDbDate(r.startsOn),
  }));
}
