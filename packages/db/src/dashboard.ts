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
  civilFromDbDate,
  dbDateFromCivil,
  firstDayOf,
  dayOfMonth,
  resolvePayer,
  SHARED_PAYER_PARAM,
  type CashAccount,
  type CivilDate,
  type MonthKey,
  type ScheduledRecurrence,
  type SpendingNature,
  type SpendingRow,
} from "@fintrack/core";
import type { WalletScope } from "./access";
import { Prisma, type PrismaClient } from "./generated/prisma/client";
import { fromDbDecimal } from "./money";

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

/** A natureza do gasto (spendingNature), em SQL. */
const NATURE_SQL = Prisma.sql`CASE
    WHEN t."recurrenceId" IS NOT NULL THEN 'fixed'
    WHEN t."installmentGroupId" IS NOT NULL THEN 'installment'
    ELSE 'variable'
  END`;

type RawSpending = {
  month: string;
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
 * O gasto e as entradas de `from` a `to` (meses, inclusive), somados por mês, ambiente,
 * categoria, quem pagou, natureza e "até hoje ou depois". Uma consulta só, com o índice
 * (walletId, occurredOn) do M04: com 24 meses de seed, poucos milissegundos.
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
      to_char(t."occurredOn", 'YYYY-MM') AS "month",
      t."walletId"::text AS "walletId",
      t."categoryId"::text AS "categoryId",
      ${PAYER_SQL} AS "payer",
      ${NATURE_SQL} AS "nature",
      (t."occurredOn" <= ${today}::date) AS "upToToday",
      COALESCE(SUM(-t."amount") FILTER (WHERE t."amount" < 0), 0) AS "expense",
      COALESCE(SUM(t."amount") FILTER (WHERE t."amount" > 0), 0) AS "income",
      MIN(t."occurredOn") FILTER (WHERE t."amount" < 0 AND t."occurredOn" > ${today}::date)
        AS "firstAfterToday"
    FROM "transaction" t
    JOIN "financial_account" a ON a."id" = t."accountId"
    LEFT JOIN "payment_card" c ON c."id" = t."cardId"
    WHERE t."walletId" = ANY(${walletIdsOf(scope)}::uuid[])
      AND t."deletedAt" IS NULL
      AND t."transferId" IS NULL
      AND t."occurredOn" BETWEEN ${from}::date AND ${to}::date
    GROUP BY 1, 2, 3, 4, 5, 6
  `);
  return rows.map((r) => ({
    month: r.month,
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

/** Uma recorrência do escopo, pronta para virar previsão (orçamento e fluxo de caixa). */
export type RecurrencePlan = ScheduledRecurrence & {
  walletId: string;
  categoryId: string | null;
  /** "Pago por" da recorrência: a mesma regra do lançamento (cartão, portador, titular) */
  payer: string | null;
  accountId: string;
  account: CashAccount;
};

/**
 * As recorrências ativas do escopo e os meses em que cada uma já gerou lançamento. Lançamento
 * gerado e depois excluído também conta como "já gerado": quem excluiu decidiu que aquele mês não
 * acontece, e "Lançar as deste mês" também não o recria (chave única do M04).
 */
export async function recurrencePlans(
  db: PrismaClient,
  scope: WalletScope<"view">,
  months: readonly MonthKey[],
): Promise<RecurrencePlan[]> {
  if (months.length === 0) return [];
  const recurrences = await db.recurrence.findMany({
    where: { walletId: { in: walletIdsOf(scope) }, archivedAt: null },
    orderBy: { id: "asc" },
    select: {
      id: true,
      walletId: true,
      categoryId: true,
      accountId: true,
      amount: true,
      dayOfMonth: true,
      startsOn: true,
      endsOn: true,
      account: { select: { kind: true, holderId: true, closingDay: true, dueDay: true } },
      card: { select: { holderId: true, sharedPurchases: true } },
      transactions: {
        where: {
          occurredOn: {
            gte: dbDateFromCivil(firstDayOf(months[0] as MonthKey)),
            lte: dbDateFromCivil(dayOfMonth(months.at(-1) as MonthKey, 31)),
          },
        },
        select: { occurredOn: true },
      },
    },
  });
  return recurrences.map((r) => {
    const payer = resolvePayer({ card: r.card, account: r.account });
    return {
      id: r.id,
      walletId: r.walletId,
      categoryId: r.categoryId,
      accountId: r.accountId,
      payer:
        payer.kind === "shared"
          ? SHARED_PAYER_PARAM
          : payer.kind === "person"
            ? payer.userId
            : null,
      amount: fromDbDecimal(r.amount),
      dayOfMonth: r.dayOfMonth,
      startsOn: civilFromDbDate(r.startsOn),
      endsOn: r.endsOn ? civilFromDbDate(r.endsOn) : null,
      materialized: new Set(r.transactions.map((t) => civilFromDbDate(t.occurredOn).slice(0, 7))),
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

type RawCash = {
  occurredOn: Date;
  accountId: string;
  accountName: string;
  kind: string;
  closingDay: number | null;
  dueDay: number | null;
  statementDue: Date | null;
  fromRecurrence: boolean;
  amount: Prisma.Decimal;
};

/** Um grupo de lançamentos com o que o fluxo de caixa precisa (data, conta, fatura, sinal). */
export type CashRow = {
  occurredOn: CivilDate;
  accountId: string;
  accountName: string;
  account: CashAccount;
  statementDue: CivilDate | null;
  fromRecurrence: boolean;
  /** Soma com sinal (entradas e saídas separadas: uma linha para cada sinal) */
  amount: bigint;
};

/**
 * Os lançamentos que podem cair no fluxo de caixa entre `from` e `to` (datas de caixa). Começa
 * dois meses antes: uma compra no cartão em agosto pode vencer em outubro. Somados por dia, conta,
 * fatura, origem e sinal (o fluxo não precisa de cada compra; a lista mostra cada uma).
 */
export async function cashRows(
  db: PrismaClient,
  scope: WalletScope<"view">,
  from: CivilDate,
  to: CivilDate,
): Promise<CashRow[]> {
  const rows = await db.$queryRaw<RawCash[]>(Prisma.sql`
    SELECT
      t."occurredOn" AS "occurredOn",
      t."accountId"::text AS "accountId",
      a."name" AS "accountName",
      a."kind"::text AS "kind",
      a."closingDay" AS "closingDay",
      a."dueDay" AS "dueDay",
      s."dueDate" AS "statementDue",
      (t."recurrenceId" IS NOT NULL) AS "fromRecurrence",
      SUM(t."amount") AS "amount"
    FROM "transaction" t
    JOIN "financial_account" a ON a."id" = t."accountId"
    LEFT JOIN "card_statement" s ON s."id" = t."statementId"
    WHERE t."walletId" = ANY(${walletIdsOf(scope)}::uuid[])
      AND t."deletedAt" IS NULL
      AND t."transferId" IS NULL
      AND t."occurredOn" BETWEEN (${dbDateFromCivil(from)}::date - interval '2 months')::date
                             AND ${dbDateFromCivil(to)}::date
    GROUP BY 1, 2, 3, 4, 5, 6, 7, 8, (t."amount" > 0)
  `);
  return rows.map((r) => ({
    occurredOn: civilFromDbDate(r.occurredOn),
    accountId: r.accountId,
    accountName: r.accountName,
    account: {
      kind: r.kind,
      cycle:
        r.closingDay !== null && r.dueDay !== null
          ? { closingDay: r.closingDay, dueDay: r.dueDay }
          : null,
    },
    statementDue: r.statementDue ? civilFromDbDate(r.statementDue) : null,
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
