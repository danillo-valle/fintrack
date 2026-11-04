// As faturas do cartão (M09.1; uma fonte só desde o M13.3a, ADR-025).
//
// Toda compra no cartão tem fatura (o gatilho transaction_card_statement): a aberta, a que o banco
// ou o PDF fechou, ou uma futura (as parcelas). A página de Cartões e o Início leem só daqui:
//
//   cardStatements     as faturas de um cartão, uma linha por fatura, com o que cada uma soma
//   statementPurchases as compras de uma fatura (a lista da página de Cartões)
//   statementsDueIn    as faturas que vencem num mês (as "Faturas a pagar" do Início)
//   alignOpenStatement as datas da fatura aberta que o banco informa (a busca do Meu Pluggy)
//
// "Quanto vem nesta fatura" soma TODAS as compras dela, inclusive as que ainda esperam revisão:
// é o que o banco vai cobrar (ADR-025, "dinheiro de verdade"). Estorno abate. A conferência ao
// centavo continua só nas faturas que o banco ou o PDF fecharam, e só com as compras que vieram
// de lá (os lançamentos manuais do mesmo cartão são casados na revisão, M09.2).
//
// Quem vê: quem vê a carteira que gere a conta (AccountViewGrant). O titular vê a fatura INTEIRA,
// inclusive as compras do adicional do cônjuge, que entram no ambiente de quem usou o cartão
// (regra do M04: "titular vê a fatura inteira"; é o que o próprio banco mostra a ele).
import {
  civilFromDbDate,
  compareCivil,
  dbDateFromCivil,
  resolvePayer,
  settlementCheck,
  spendingNature,
  statementForDueDate,
  statementState,
  statementWindow,
  type CivilDate,
  type MonthKey,
  type SpendingNature,
  type StatementState,
} from "@fintrack/core";
import type { AccountViewGrant } from "./access";
import { monthAsRange } from "./cash";
import type { Prisma, PrismaClient } from "./generated/prisma/client";
import type { StatementChargeKind, TransactionSource } from "./generated/prisma/enums";
import { fromDbDecimal, fromDbDecimalOrNull } from "./money";

/** As faturas que o banco ou o PDF fecharam (as que têm total e conferência). */
const CLOSING_SOURCES = ["OPEN_FINANCE", "PDF"] as const satisfies readonly TransactionSource[];
/** As compras que contam na conferência: as que vieram do banco ou de arquivo. */
const IMPORTED_SOURCES = [
  "OPEN_FINANCE",
  "OFX",
  "PDF",
] as const satisfies readonly TransactionSource[];

/** Uma compra da fatura: não apagada e não transferência (o pagamento da fatura é uma). */
const PURCHASE_WHERE = { deletedAt: null, transferId: null } satisfies Prisma.TransactionWhereInput;

const PURCHASE_SELECT = {
  id: true,
  occurredOn: true,
  description: true,
  label: true,
  amount: true,
  status: true,
  source: true,
  categorizedBy: true,
  categorizationConfidence: true,
  providerCategory: true,
  providerInstallmentNumber: true,
  providerInstallmentCount: true,
  installmentNumber: true,
  installmentGroupId: true,
  installmentGroup: { select: { installmentCount: true } },
  recurrenceId: true,
  originalAmount: true,
  originalCurrency: true,
  walletId: true,
  wallet: { select: { name: true } },
  category: { select: { id: true, name: true, parent: { select: { name: true } } } },
  card: { select: { lastFour: true, holderId: true, sharedPurchases: true } },
  account: { select: { holderId: true } },
} satisfies Prisma.TransactionSelect;

type PurchaseRow = Prisma.TransactionGetPayload<{ select: typeof PURCHASE_SELECT }>;

export type StatementPurchase = ReturnType<typeof toPurchase>;

function toPurchase(row: PurchaseRow, accountWalletId: string) {
  return {
    id: row.id,
    occurredOn: civilFromDbDate(row.occurredOn),
    description: row.description,
    /** "O que foi" (M13.2) */
    label: row.label,
    amount: fromDbDecimal(row.amount),
    status: row.status,
    categorizedBy: row.categorizedBy,
    categorizationConfidence: row.categorizationConfidence,
    category: row.category
      ? { id: row.category.id, name: row.category.name, parent: row.category.parent?.name ?? null }
      : null,
    installment:
      row.installmentNumber !== null && row.installmentGroup
        ? { number: row.installmentNumber, count: row.installmentGroup.installmentCount }
        : row.providerInstallmentNumber !== null && row.providerInstallmentCount !== null
          ? { number: row.providerInstallmentNumber, count: row.providerInstallmentCount }
          : null,
    /** Fixa, parcela ou variável (spendingNature): as abas da fatura */
    nature: spendingNature(row),
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

/** Quanto uma fatura soma em cada tipo de despesa (as abas e o resumo da página de Cartões). */
export type NatureTotals = Record<SpendingNature, bigint>;

/** Uma fatura com o que ela soma e em que pé está. */
export type CardStatementSummary = {
  id: string;
  referenceMonth: MonthKey;
  closingDate: CivilDate;
  dueDate: CivilDate;
  /** O período das compras (do fechamento anterior à véspera do fechamento dela) */
  window: { start: CivilDate; end: CivilDate };
  state: StatementState;
  /** As compras, com os estornos abatidos e os recebidos ainda não conferidos (positivo = a pagar) */
  purchases: bigint;
  purchaseCount: number;
  /** Quantas compras dela ainda esperam revisão */
  pendingCount: number;
  byNature: NatureTotals;
  /** A fatura fechada pelo banco ou pelo PDF: o total, o mínimo, os encargos e a conferência */
  closed: {
    source: (typeof CLOSING_SOURCES)[number];
    total: bigint;
    minimumPayment: bigint | null;
    charges: { kind: StatementChargeKind; amount: bigint }[];
    /** As compras que vieram do banco ou de arquivo: as que a conferência soma (positivo) */
    importedPurchases: bigint;
    importedCount: number;
    check: { kind: "matches" } | { kind: "partial" } | { kind: "difference"; difference: bigint };
  } | null;
  /** Os pagamentos que o banco informou */
  payments: { paidOn: CivilDate; amount: bigint }[];
  paid: bigint;
};

const NO_NATURES: NatureTotals = { fixed: 0n, installment: 0n, variable: 0n };

/**
 * As faturas de um cartão que têm alguma compra ou foram fechadas pelo banco ou pelo PDF, da que
 * vence antes para a que vence depois. Uma fatura aberta sem compra nenhuma (criada e esvaziada)
 * não aparece.
 */
export async function cardStatements(
  db: PrismaClient,
  /** A conta já autorizada: pelo crachá da conta (Cartões) ou pelo escopo (Início) */
  account: Pick<AccountViewGrant["account"], "id" | "connectionId">,
  today: CivilDate,
): Promise<CardStatementSummary[]> {
  const [statements, sums, importFrom] = await Promise.all([
    db.cardStatement.findMany({
      where: { accountId: account.id },
      orderBy: { closingDate: "asc" },
      select: {
        id: true,
        referenceMonth: true,
        closingDate: true,
        dueDate: true,
        total: true,
        minimumPayment: true,
        status: true,
        source: true,
        charges: { select: { kind: true, amount: true } },
        payments: { orderBy: { paidOn: "asc" }, select: { paidOn: true, amount: true } },
      },
    }),
    db.transaction.findMany({
      where: { accountId: account.id, ...PURCHASE_WHERE, statementId: { not: null } },
      select: {
        statementId: true,
        amount: true,
        status: true,
        source: true,
        recurrenceId: true,
        installmentGroupId: true,
        providerInstallmentCount: true,
      },
    }),
    account.connectionId
      ? db.providerConnection.findUnique({
          where: { id: account.connectionId },
          select: { importFrom: true },
        })
      : null,
  ]);
  type Sums = {
    purchases: bigint;
    imported: bigint;
    importedCount: number;
    count: number;
    pending: number;
    byNature: NatureTotals;
  };
  const byStatement = new Map<string, Sums>();
  for (const t of sums) {
    const id = t.statementId as string;
    const entry = byStatement.get(id) ?? {
      purchases: 0n,
      imported: 0n,
      importedCount: 0,
      count: 0,
      pending: 0,
      byNature: { ...NO_NATURES },
    };
    const amount = fromDbDecimal(t.amount);
    entry.purchases -= amount;
    if ((IMPORTED_SOURCES as readonly string[]).includes(t.source)) {
      entry.imported += amount;
      entry.importedCount += 1;
    }
    entry.count += 1;
    if (t.status === "PENDING") entry.pending += 1;
    entry.byNature[spendingNature(t)] -= amount;
    byStatement.set(id, entry);
  }
  const cutoff = importFrom?.importFrom ? civilFromDbDate(importFrom.importFrom) : null;

  const result: CardStatementSummary[] = [];
  statements.forEach((s, index) => {
    const closedBy = (CLOSING_SOURCES as readonly string[]).includes(s.source) && s.total !== null;
    const sum = byStatement.get(s.id);
    if (!sum && !closedBy) return;
    const closingDate = civilFromDbDate(s.closingDate);
    const previous = statements[index - 1];
    const window = statementWindow({
      closingDate,
      previousClosingDate: previous ? civilFromDbDate(previous.closingDate) : null,
    });
    const payments = s.payments.map((p) => ({
      paidOn: civilFromDbDate(p.paidOn),
      amount: fromDbDecimal(p.amount),
    }));
    const paid = payments.reduce((total, p) => total + p.amount, 0n);
    let closed: CardStatementSummary["closed"] = null;
    if (closedBy) {
      const total = fromDbDecimal(s.total as Prisma.Decimal);
      const charges = s.charges.map((c) => ({ kind: c.kind, amount: fromDbDecimal(c.amount) }));
      const check = settlementCheck({
        total,
        charges: charges.map((c) => c.amount),
        purchases: [sum?.imported ?? 0n],
      });
      // A fatura começa no fechamento anterior: se for antes da data de corte, parte das compras
      // ficou de fora de propósito, e a conferência não vale
      const partial = cutoff !== null && compareCivil(window.start, cutoff) < 0 && !check.matches;
      closed = {
        source: s.source as (typeof CLOSING_SOURCES)[number],
        total,
        minimumPayment: fromDbDecimalOrNull(s.minimumPayment),
        charges,
        importedPurchases: -(sum?.imported ?? 0n),
        importedCount: sum?.importedCount ?? 0,
        check: partial
          ? { kind: "partial" }
          : check.matches
            ? { kind: "matches" }
            : { kind: "difference", difference: check.difference },
      };
    }
    result.push({
      id: s.id,
      referenceMonth: civilFromDbDate(s.referenceMonth).slice(0, 7),
      closingDate,
      dueDate: civilFromDbDate(s.dueDate),
      window,
      state: statementState({
        window,
        today,
        paid: s.status === "PAID" || (closed !== null && closed.total > 0n && paid >= closed.total),
      }),
      purchases: sum?.purchases ?? 0n,
      purchaseCount: sum?.count ?? 0,
      pendingCount: sum?.pending ?? 0,
      byNature: sum?.byNature ?? { ...NO_NATURES },
      closed,
      payments,
      paid,
    });
  });
  return result;
}

/** As compras de uma fatura, da mais recente para a mais antiga. */
export async function statementPurchases(
  db: PrismaClient,
  grant: AccountViewGrant,
  statementId: string,
): Promise<StatementPurchase[]> {
  const rows = await db.transaction.findMany({
    where: { accountId: grant.account.id, statementId, ...PURCHASE_WHERE },
    orderBy: [{ occurredOn: "desc" }, { id: "desc" }],
    select: PURCHASE_SELECT,
  });
  return rows.map((row) => toPurchase(row, grant.account.walletId));
}

/** Uma fatura que vence num mês, para as "Faturas a pagar" do Início. */
export type DueStatement = {
  accountId: string;
  statementId: string;
  closingDate: CivilDate;
  dueDate: CivilDate;
  /** O total do banco, se ele já fechou a fatura; senão, a soma das compras até agora */
  amount: bigint;
  /** A fatura ainda recebe compras (o valor ainda vai crescer) */
  open: boolean;
  paid: boolean;
};

/**
 * As faturas dos cartões pedidos que vencem no mês (uma por cartão, normalmente), com o valor de
 * cada uma. Fatura sem compra e sem total do banco não entra.
 */
export async function statementsDueIn(
  db: PrismaClient,
  accountIds: readonly string[],
  month: MonthKey,
  today: CivilDate,
): Promise<DueStatement[]> {
  if (accountIds.length === 0) return [];
  const range = monthAsRange(month);
  const statements = await db.cardStatement.findMany({
    where: {
      accountId: { in: [...accountIds] },
      dueDate: { gte: dbDateFromCivil(range.from), lte: dbDateFromCivil(range.to) },
    },
    orderBy: [{ dueDate: "asc" }, { accountId: "asc" }],
    select: {
      id: true,
      accountId: true,
      closingDate: true,
      dueDate: true,
      total: true,
      status: true,
      source: true,
      payments: { select: { amount: true } },
    },
  });
  if (statements.length === 0) return [];
  const sums = await db.transaction.groupBy({
    by: ["statementId"],
    where: { statementId: { in: statements.map((s) => s.id) }, ...PURCHASE_WHERE },
    _sum: { amount: true },
  });
  const sumOf = new Map(sums.map((s) => [s.statementId, s._sum.amount]));
  return statements.flatMap((s) => {
    const closedBy = (CLOSING_SOURCES as readonly string[]).includes(s.source) && s.total !== null;
    const sum = sumOf.get(s.id);
    if (!closedBy && !sum) return [];
    const amount = closedBy
      ? fromDbDecimal(s.total as Prisma.Decimal)
      : sum
        ? -fromDbDecimal(sum)
        : 0n;
    const paid = s.payments.reduce((total, p) => total + fromDbDecimal(p.amount), 0n);
    return [
      {
        accountId: s.accountId,
        statementId: s.id,
        closingDate: civilFromDbDate(s.closingDate),
        dueDate: civilFromDbDate(s.dueDate),
        amount,
        open: compareCivil(today, civilFromDbDate(s.closingDate)) < 0,
        paid: s.status === "PAID" || (closedBy && amount > 0n && paid >= amount),
      },
    ];
  });
}

/**
 * As datas da fatura aberta, como o banco informa (a busca do Meu Pluggy): a fatura do ciclo
 * daquele vencimento (a mesma que a Bill usaria, statementForDueDate) passa a fechar e vencer
 * nas datas do banco, e as compras do período dela que ainda estão numa fatura que o banco não
 * fechou voltam a ser escolhidas pelo gatilho (ADR-025). Fatura que o banco já fechou não muda.
 * Sem datas futuras do banco, nada muda: a fatura do ciclo continua valendo.
 */
export async function alignOpenStatement(
  db: PrismaClient,
  account: { id: string; closingDay: number | null; dueDay: number | null },
  bank: { closeDate: CivilDate | null; dueDate: CivilDate | null },
  today: CivilDate,
): Promise<void> {
  const { closeDate, dueDate } = bank;
  if (!closeDate || !dueDate || compareCivil(closeDate, today) <= 0) return;
  if (compareCivil(dueDate, closeDate) <= 0) return;
  const cycle =
    account.closingDay !== null && account.dueDay !== null
      ? { closingDay: account.closingDay, dueDay: account.dueDay }
      : null;
  const statement = statementForDueDate(dueDate, cycle, closeDate);
  const referenceMonth = dbDateFromCivil(`${statement.referenceMonth}-01`);
  await db.$transaction(async (tx) => {
    const current = await tx.cardStatement.findUnique({
      where: { accountId_referenceMonth: { accountId: account.id, referenceMonth } },
      select: { id: true, total: true, closingDate: true, dueDate: true },
    });
    if (current?.total != null) return; // o banco já fechou esta fatura
    const dates = { closingDate: dbDateFromCivil(closeDate), dueDate: dbDateFromCivil(dueDate) };
    if (
      current &&
      civilFromDbDate(current.closingDate) === closeDate &&
      civilFromDbDate(current.dueDate) === dueDate
    ) {
      return;
    }
    const saved = await tx.cardStatement.upsert({
      where: { accountId_referenceMonth: { accountId: account.id, referenceMonth } },
      create: { accountId: account.id, referenceMonth, ...dates },
      update: dates,
      select: { id: true },
    });
    // As compras do período (do fechamento anterior gravado à véspera deste) que estão numa
    // fatura aberta passam pelo gatilho de novo: statementId nulo é "escolha pelo dia"
    const previous = await tx.cardStatement.findFirst({
      where: { accountId: account.id, closingDate: { lt: dates.closingDate } },
      orderBy: { closingDate: "desc" },
      select: { closingDate: true },
    });
    const window = statementWindow({
      closingDate: closeDate,
      previousClosingDate: previous ? civilFromDbDate(previous.closingDate) : null,
    });
    await tx.transaction.updateMany({
      where: {
        accountId: account.id,
        transferId: null,
        occurredOn: {
          gte: dbDateFromCivil(window.start),
          lte: dbDateFromCivil(window.end),
        },
        statementId: { not: saved.id },
        statement: { is: { total: null } },
      },
      data: { statementId: null },
    });
  });
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

/** Um pagamento de fatura: quando, quanto e de qual conta saiu (quando dá para saber). */
export type StatementPaymentLine = {
  paidOn: CivilDate;
  amount: bigint;
  fromAccount: string | null;
};

/**
 * Como uma fatura foi paga: as transferências que entraram no cartão entre o fechamento e dez dias
 * depois do vencimento (o pagamento da fatura ligado na revisão, M13.2), com a conta de onde
 * saíram; sem nenhuma, os pagamentos que o banco informou na fatura. Uma linha por pagamento.
 */
export async function statementPaymentLines(
  db: PrismaClient,
  accountId: string,
  statement: {
    closingDate: CivilDate;
    dueDate: CivilDate;
    payments: CardStatementSummary["payments"];
  },
): Promise<StatementPaymentLine[]> {
  const until = new Date(dbDateFromCivil(statement.dueDate).getTime() + 10 * 86_400_000);
  const incoming = await db.transaction.findMany({
    where: {
      accountId,
      deletedAt: null,
      transferId: { not: null },
      amount: { gt: 0 },
      occurredOn: { gte: dbDateFromCivil(statement.closingDate), lte: until },
    },
    orderBy: { occurredOn: "asc" },
    select: { occurredOn: true, amount: true, transferId: true },
  });
  if (incoming.length === 0) {
    return statement.payments.map((p) => ({ ...p, fromAccount: null }));
  }
  const peers = await db.transaction.findMany({
    where: {
      transferId: { in: incoming.map((t) => t.transferId as string) },
      accountId: { not: accountId },
      deletedAt: null,
    },
    select: { transferId: true, account: { select: { name: true } } },
  });
  const nameOf = new Map(peers.map((p) => [p.transferId, p.account.name]));
  return incoming.map((t) => ({
    paidOn: civilFromDbDate(t.occurredOn),
    amount: fromDbDecimal(t.amount),
    fromAccount: nameOf.get(t.transferId) ?? null,
  }));
}

/**
 * Os cartões de crédito (contas de fatura) das carteiras pedidas, ligados ao banco ou não, com os
 * plásticos (só o final), o limite que o banco informa e quem usa (M13.3a, a página de Cartões).
 */
export async function cardAccountsOf(db: PrismaClient, walletIds: readonly string[]) {
  if (walletIds.length === 0) return [];
  const rows = await db.financialAccount.findMany({
    where: { walletId: { in: [...walletIds] }, kind: "CREDIT_CARD", archivedAt: null },
    orderBy: [{ name: "asc" }, { id: "asc" }],
    select: {
      id: true,
      name: true,
      institution: true,
      connectionId: true,
      holderId: true,
      cards: {
        where: { archivedAt: null },
        orderBy: { createdAt: "asc" },
        select: { lastFour: true, holderId: true },
      },
      bankBalance: { select: { creditLimit: true, availableCredit: true, asOf: true } },
    },
  });
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    institution: row.institution,
    connectionId: row.connectionId,
    lastFour: row.cards[0]?.lastFour ?? null,
    holderIds: [
      ...new Set(
        [row.holderId, ...row.cards.map((c) => c.holderId)].filter(
          (id): id is string => id !== null,
        ),
      ),
    ],
    creditLimit: fromDbDecimalOrNull(row.bankBalance?.creditLimit ?? null),
    availableCredit: fromDbDecimalOrNull(row.bankBalance?.availableCredit ?? null),
  }));
}

export type CardAccount = Awaited<ReturnType<typeof cardAccountsOf>>[number];
