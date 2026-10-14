// A página do cartão (M09.1): a fatura aberta (calculada das compras recebidas do banco) e as
// faturas fechadas que o banco mandou (Bill → CardStatement), com a conferência ao centavo.
//
// Quem vê: quem vê a carteira que gere a conta (AccountViewGrant). O titular vê a fatura INTEIRA,
// inclusive as compras do adicional do cônjuge, que entram no ambiente de quem usou o cartão
// (regra do M04: "titular vê a fatura inteira"; é o que o próprio banco mostra a ele).
//
// No M09.1 a fatura conta só o que veio do banco (source OPEN_FINANCE): os lançamentos manuais
// do mesmo cartão são casados com os do banco na reconciliação do M09.2.
import {
  civilFromDbDate,
  compareCivil,
  dbDateFromCivil,
  openStatementWindow,
  resolvePayer,
  settlementCheck,
  type CivilDate,
} from "@fintrack/core";
import type { AccountViewGrant } from "./access";
import type { Prisma, PrismaClient } from "./generated/prisma/client";
import { fromDbDecimal, fromDbDecimalOrNull } from "./money";

const RECEIVED_SELECT = {
  id: true,
  occurredOn: true,
  description: true,
  amount: true,
  status: true,
  categorizedBy: true,
  providerCategory: true,
  providerInstallmentNumber: true,
  providerInstallmentCount: true,
  originalAmount: true,
  originalCurrency: true,
  walletId: true,
  wallet: { select: { name: true } },
  category: { select: { id: true, name: true, parent: { select: { name: true } } } },
  card: { select: { lastFour: true, holderId: true, sharedPurchases: true } },
  account: { select: { holderId: true } },
} satisfies Prisma.TransactionSelect;

type ReceivedRow = Prisma.TransactionGetPayload<{ select: typeof RECEIVED_SELECT }>;

export type ReceivedItem = ReturnType<typeof toReceived>;

function toReceived(row: ReceivedRow, accountWalletId: string) {
  return {
    id: row.id,
    occurredOn: civilFromDbDate(row.occurredOn),
    description: row.description,
    amount: fromDbDecimal(row.amount),
    status: row.status,
    categorizedBy: row.categorizedBy,
    category: row.category
      ? { id: row.category.id, name: row.category.name, parent: row.category.parent?.name ?? null }
      : null,
    installment:
      row.providerInstallmentNumber !== null && row.providerInstallmentCount !== null
        ? { number: row.providerInstallmentNumber, count: row.providerInstallmentCount }
        : null,
    original:
      row.originalAmount !== null && row.originalCurrency !== null
        ? { amount: fromDbDecimal(row.originalAmount), currency: row.originalCurrency }
        : null,
    cardLastFour: row.card?.lastFour ?? null,
    payer: resolvePayer({ card: row.card, account: row.account }),
    /** Ambiente diferente do da conta (o adicional do cônjuge): a tela diz onde entrou */
    otherWallet: row.walletId !== accountWalletId ? row.wallet.name : null,
  };
}

/** Tudo que a página do cartão mostra. */
export async function cardStatementView(
  db: PrismaClient,
  grant: AccountViewGrant,
  today: CivilDate,
) {
  const { account } = grant;
  const [balance, closed] = await Promise.all([
    db.accountBalance.findUnique({ where: { accountId: account.id } }),
    db.cardStatement.findMany({
      where: { accountId: account.id, source: "OPEN_FINANCE", total: { not: null } },
      orderBy: { dueDate: "desc" },
      take: 6,
      select: {
        id: true,
        referenceMonth: true,
        closingDate: true,
        dueDate: true,
        total: true,
        minimumPayment: true,
        status: true,
        charges: { select: { kind: true, amount: true } },
        payments: { orderBy: { paidOn: "asc" }, select: { paidOn: true, amount: true } },
      },
    }),
  ]);
  const cycle =
    account.closingDay !== null && account.dueDay !== null
      ? { closingDay: account.closingDay, dueDay: account.dueDay }
      : null;
  const window = openStatementWindow({
    today,
    cycle,
    bankCloseDate: balance?.closeDate ? civilFromDbDate(balance.closeDate) : null,
    bankDueDate: balance?.dueDate ? civilFromDbDate(balance.dueDate) : null,
  });

  // Fatura aberta: compras recebidas do banco que ainda não têm fatura fechada
  const openRows = window
    ? await db.transaction.findMany({
        where: {
          accountId: account.id,
          source: "OPEN_FINANCE",
          deletedAt: null,
          transferId: null,
          statementId: null,
          occurredOn: { gte: dbDateFromCivil(window.from), lte: dbDateFromCivil(today) },
        },
        orderBy: [{ occurredOn: "desc" }, { id: "desc" }],
        select: RECEIVED_SELECT,
      })
    : [];
  const open = openRows.map((r) => toReceived(r, account.walletId));
  const openTotal = open.reduce((sum, t) => sum - t.amount, 0n);

  // Faturas fechadas: a conferência com as compras ligadas a cada uma
  const importFrom = account.connectionId
    ? await db.providerConnection.findUnique({
        where: { id: account.connectionId },
        select: { importFrom: true },
      })
    : null;
  const cutoff = importFrom?.importFrom ? civilFromDbDate(importFrom.importFrom) : null;
  const sums = closed.length
    ? await db.transaction.groupBy({
        by: ["statementId"],
        where: {
          statementId: { in: closed.map((s) => s.id) },
          source: "OPEN_FINANCE",
          deletedAt: null,
          transferId: null,
        },
        _sum: { amount: true },
        _count: { _all: true },
      })
    : [];
  const sumOf = new Map(sums.map((s) => [s.statementId, s]));
  const statements = closed.map((s, index) => {
    const total = fromDbDecimal(s.total as Prisma.Decimal);
    const charges = s.charges.map((c) => ({ kind: c.kind, amount: fromDbDecimal(c.amount) }));
    const linked = sumOf.get(s.id);
    const purchasesSum = linked?._sum.amount ? fromDbDecimal(linked._sum.amount) : 0n;
    const check = settlementCheck({
      total,
      charges: charges.map((c) => c.amount),
      purchases: [purchasesSum],
    });
    // A fatura começa no fechamento anterior: se for antes da data de corte, parte das compras
    // ficou de fora de propósito, e a conferência não vale
    const previousClose = closed[index + 1]?.closingDate;
    const periodStart = previousClose
      ? civilFromDbDate(previousClose)
      : civilFromDbDate(new Date(s.closingDate.getTime() - 31 * 86_400_000));
    const partial = cutoff !== null && compareCivil(periodStart, cutoff) < 0 && !check.matches;
    const paid = s.payments.reduce((sum, p) => sum + fromDbDecimal(p.amount), 0n);
    return {
      id: s.id,
      referenceMonth: civilFromDbDate(s.referenceMonth).slice(0, 7),
      closingDate: civilFromDbDate(s.closingDate),
      dueDate: civilFromDbDate(s.dueDate),
      total,
      minimumPayment: fromDbDecimalOrNull(s.minimumPayment),
      status: s.status,
      purchases: -purchasesSum,
      purchaseCount: linked?._count._all ?? 0,
      charges,
      payments: s.payments.map((p) => ({
        paidOn: civilFromDbDate(p.paidOn),
        amount: fromDbDecimal(p.amount),
      })),
      paid,
      check: partial
        ? ({ kind: "partial" } as const)
        : check.matches
          ? ({ kind: "matches" } as const)
          : ({ kind: "difference", difference: check.difference } as const),
    };
  });

  return {
    account,
    balance: balance
      ? {
          creditLimit: fromDbDecimalOrNull(balance.creditLimit),
          availableCredit: fromDbDecimalOrNull(balance.availableCredit),
          asOf: balance.asOf,
        }
      : null,
    window,
    open,
    openTotal,
    statements,
  };
}

/**
 * Quantos lançamentos recebidos do banco esperam revisão nas carteiras do escopo, e quanto
 * somam (só saídas). É o aviso "23 lançamentos recebidos do banco" do Início.
 */
export async function receivedSummary(db: PrismaClient, walletIds: readonly string[]) {
  if (walletIds.length === 0) return { count: 0, uncategorized: 0 };
  const [count, uncategorized] = await Promise.all([
    db.transaction.count({
      where: { walletId: { in: [...walletIds] }, status: "PENDING", deletedAt: null },
    }),
    db.transaction.count({
      where: {
        walletId: { in: [...walletIds] },
        status: "PENDING",
        deletedAt: null,
        categoryId: null,
        transferId: null,
      },
    }),
  ]);
  return { count, uncategorized };
}

/**
 * A fatura aberta de cada cartão (a soma das compras recebidas sem fatura fechada, no período da
 * fatura aberta), para os cartões do Início. Mesma regra da página do cartão.
 */
export async function openStatementTotals(
  db: PrismaClient,
  accountIds: readonly string[],
  today: CivilDate,
): Promise<Map<string, bigint>> {
  const accounts = await db.financialAccount.findMany({
    where: { id: { in: [...accountIds] }, kind: "CREDIT_CARD" },
    select: {
      id: true,
      closingDay: true,
      dueDay: true,
      bankBalance: { select: { closeDate: true, dueDate: true } },
    },
  });
  const totals = new Map<string, bigint>();
  for (const account of accounts) {
    const window = openStatementWindow({
      today,
      cycle:
        account.closingDay !== null && account.dueDay !== null
          ? { closingDay: account.closingDay, dueDay: account.dueDay }
          : null,
      bankCloseDate: account.bankBalance?.closeDate
        ? civilFromDbDate(account.bankBalance.closeDate)
        : null,
      bankDueDate: account.bankBalance?.dueDate
        ? civilFromDbDate(account.bankBalance.dueDate)
        : null,
    });
    if (!window) continue;
    const sum = await db.transaction.aggregate({
      where: {
        accountId: account.id,
        source: "OPEN_FINANCE",
        deletedAt: null,
        transferId: null,
        statementId: null,
        occurredOn: { gte: dbDateFromCivil(window.from), lte: dbDateFromCivil(today) },
      },
      _sum: { amount: true },
    });
    totals.set(account.id, sum._sum.amount ? -fromDbDecimal(sum._sum.amount) : 0n);
  }
  return totals;
}
