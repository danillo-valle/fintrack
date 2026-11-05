// Compra parcelada no cartão (M07.4, ADR-009): UMA compra vira N lançamentos, um por fatura,
// todos ligados ao mesmo grupo (InstallmentGroup) e numerados (1 de N, 2 de N...).
//
// O plano vem do core (installmentEntries): o valor de cada parcela, sem perder centavo (a sobra
// vai na 1ª), a fatura em que cada uma cai (pelo dia de fechamento do cartão) e o dia em que ela
// aparece na lista. As faturas que ainda não existem são criadas aqui, abertas. Tudo numa
// transação só: ou a compra entra inteira, ou não entra.
import {
  categorizedBy,
  civilFromDbDate,
  dbDateFromCivil,
  installmentEntries,
  installmentsInProgress,
  installmentSiblingKey,
  installmentStem,
  monthOf,
  projectedInstallments,
  resolvePayer,
  SHARED_PAYER_PARAM,
  signedAmount,
  statedInstallmentValid,
  todayCivil,
  type Cents,
  type CivilDate,
  type InstallmentParcel,
  type AccountKind,
  type ForecastInstallment,
  type PaymentMethod,
} from "@fintrack/core";
import {
  DomainError,
  type AccountGrant,
  type TransactionGrant,
  type WalletGrant,
  type WalletScope,
} from "./access";
import { writeAudit, type RequestContext } from "./audit";
import { assertUsableCategory, suggestCategory } from "./categories";
import type { Prisma, PrismaClient } from "./generated/prisma/client";
import { fromDbDecimal, toDbDecimal } from "./money";
import {
  recordCorrection,
  rememberForNext,
  resolvePayment,
  sameHousehold,
  type CategorizationOptions,
  type TransactionOrigin,
} from "./transactions";

/** O máximo da tela (o banco aceita até 99, para importações). */
export const MAX_INSTALLMENTS = 24;

export type InstallmentPurchaseInput = {
  /** O valor TOTAL da compra, positivo */
  cents: Cents;
  count: number;
  description: string;
  purchasedOn: CivilDate;
  categoryId: string | null;
  method?: PaymentMethod | null;
  cardId?: string | null;
  notes?: string | null;
  /** De onde veio (M11): cada parcela leva o id da origem com o número (":1", ":2"...) */
  origin?: TransactionOrigin | null;
};

export async function createInstallmentPurchase(
  db: PrismaClient,
  wallet: WalletGrant<"edit">,
  account: AccountGrant,
  input: InstallmentPurchaseInput,
  options: CategorizationOptions,
  ctx: RequestContext,
  today: CivilDate = todayCivil(),
) {
  sameHousehold(wallet, account);
  if (account.account.kind !== "CREDIT_CARD")
    throw new DomainError("INSTALLMENTS_NEED_CREDIT_CARD");
  if (!Number.isInteger(input.count) || input.count < 2 || input.count > MAX_INSTALLMENTS) {
    throw new DomainError("INSTALLMENT_COUNT_INVALID");
  }
  const { method, cardId } = resolvePayment(account, {
    kind: "expense",
    method: input.method,
    cardId: input.cardId,
  });
  const cycle = await db.financialAccount.findUniqueOrThrow({
    where: { id: account.account.id },
    select: { closingDay: true, dueDay: true },
  });
  if (cycle.closingDay === null || cycle.dueDay === null) {
    throw new DomainError("CARD_CYCLE_MISSING");
  }
  const total = signedAmount("expense", input.cents);
  const entries = installmentEntries({
    total,
    count: input.count,
    purchasedOn: input.purchasedOn,
    cycle: { closingDay: cycle.closingDay, dueDay: cycle.dueDay },
    today,
  });
  const suggestion = await suggestCategory(db, options.scope, {
    description: input.description,
    kind: "expense",
  });
  const householdId = wallet.wallet.householdId;

  return db.$transaction(async (tx) => {
    const categoryId = await assertUsableCategory(tx, householdId, input.categoryId, "expense");
    const group = await tx.installmentGroup.create({
      data: {
        householdId,
        walletId: wallet.wallet.id,
        accountId: account.account.id,
        description: input.description,
        totalAmount: toDbDecimal(total),
        installmentCount: input.count,
        purchasedOn: dbDateFromCivil(input.purchasedOn),
      },
      select: { id: true },
    });
    const ids: string[] = [];
    for (const entry of entries) {
      // A fatura do mês da parcela: a que já existe ou uma nova, aberta
      const statement = await tx.cardStatement.upsert({
        where: {
          accountId_referenceMonth: {
            accountId: account.account.id,
            referenceMonth: dbDateFromCivil(`${entry.referenceMonth}-01`),
          },
        },
        create: {
          accountId: account.account.id,
          referenceMonth: dbDateFromCivil(`${entry.referenceMonth}-01`),
          closingDate: dbDateFromCivil(entry.closingDate),
          dueDate: dbDateFromCivil(entry.dueDate),
        },
        update: {},
        select: { id: true },
      });
      const created = await tx.transaction.create({
        data: {
          householdId,
          walletId: wallet.wallet.id,
          accountId: account.account.id,
          cardId,
          method,
          categoryId,
          categorizedBy: categorizedBy(categoryId, suggestion),
          amount: toDbDecimal(entry.amount),
          occurredOn: dbDateFromCivil(entry.occurredOn),
          status: entry.status,
          description: input.description,
          notes: input.notes ?? null,
          statementId: statement.id,
          installmentGroupId: group.id,
          installmentNumber: entry.number,
          ...(input.origin
            ? {
                source: input.origin.source,
                externalId: `${input.origin.externalId}:${entry.number}`,
              }
            : {}),
          createdById: wallet.userId,
        },
        select: { id: true },
      });
      ids.push(created.id);
    }
    // A correção de categoria vale para a compra, não para cada parcela: um exemplo de treino
    await recordCorrection(tx, {
      householdId,
      transactionId: ids[0]!,
      description: input.description,
      kind: "expense",
      from: { categoryId: suggestion?.categoryId ?? null, source: suggestion?.source ?? null },
      to: categoryId,
      userId: wallet.userId,
    });
    // Parcela não tem tipo: a regra da loja guarda só a categoria (e o tipo que já dava)
    await rememberForNext(tx, options, { description: input.description, categoryId }, ctx);
    await writeAudit(
      tx,
      {
        actorId: wallet.userId,
        householdId,
        action: "installment_purchase.created",
        entity: "installment_group",
        entityId: group.id,
        metadata: { walletId: wallet.wallet.id, count: input.count },
      },
      ctx,
    );
    return { groupId: group.id, transactionIds: ids, suggestion };
  });
}

type ParcelInfo = {
  label: string | null;
  title: string;
  bankText: string;
  accountName: string;
  category: string | null;
};

/** Uma parcela gravada, com a compra a que pertence e o que o previsto precisa dela. */
type ReadParcel = InstallmentParcel & {
  /** A compra parcelada do FinTrack (todas as parcelas já gravadas) ou do banco ("2/5") */
  fromApp: boolean;
  /** Ainda na revisão (fora das somas, ADR-011) */
  pending: boolean;
  walletId: string;
  accountId: string;
  accountKind: AccountKind;
  cardId: string | null;
  categoryId: string | null;
  payer: string | null;
};

/**
 * As parcelas gravadas nas carteiras do escopo, uma por lançamento, e o nome de cada compra: o
 * "O que foi" mais recente; sem nenhum, o nome da compra parcelada do FinTrack ou o texto do banco
 * sem o "NN/NN". A parcela que a pessoa disse (ADR-027) conta como a do banco.
 */
async function readParcels(db: PrismaClient, walletIds: readonly string[]) {
  const rows = await db.transaction.findMany({
    where: {
      walletId: { in: [...walletIds] },
      deletedAt: null,
      transferId: null,
      OR: [{ installmentGroupId: { not: null } }, { providerInstallmentCount: { not: null } }],
    },
    orderBy: [{ occurredOn: "desc" }, { id: "asc" }],
    select: {
      walletId: true,
      accountId: true,
      cardId: true,
      categoryId: true,
      status: true,
      amount: true,
      description: true,
      label: true,
      occurredOn: true,
      installmentGroupId: true,
      installmentNumber: true,
      installmentGroup: { select: { installmentCount: true, description: true } },
      providerInstallmentNumber: true,
      providerInstallmentCount: true,
      statement: { select: { dueDate: true } },
      account: { select: { name: true, kind: true, holderId: true } },
      card: { select: { holderId: true, sharedPurchases: true } },
      category: { select: { name: true } },
    },
  });
  const info = new Map<string, ParcelInfo>();
  const parcels: ReadParcel[] = [];
  for (const r of rows) {
    const amount = fromDbDecimal(r.amount);
    const number = r.installmentNumber ?? r.providerInstallmentNumber;
    const count = r.installmentGroup?.installmentCount ?? r.providerInstallmentCount;
    const key =
      r.installmentGroupId ??
      installmentSiblingKey({
        accountId: r.accountId,
        amount,
        description: r.description,
        installmentCount: r.providerInstallmentCount,
      });
    if (!key || number === null || count === null) continue;
    const payer = resolvePayer({ card: r.card, account: r.account });
    parcels.push({
      key,
      number,
      count,
      amount,
      dueDate: civilFromDbDate(r.statement?.dueDate ?? r.occurredOn),
      fromApp: r.installmentGroupId !== null,
      pending: r.status === "PENDING",
      walletId: r.walletId,
      accountId: r.accountId,
      accountKind: r.account.kind,
      cardId: r.cardId,
      categoryId: r.categoryId,
      payer:
        payer.kind === "shared"
          ? SHARED_PAYER_PARAM
          : payer.kind === "person"
            ? payer.userId
            : null,
    });
    const known = info.get(key);
    const bankText = installmentStem(r.description);
    info.set(key, {
      label: known?.label ?? r.label,
      title: known?.title ?? r.installmentGroup?.description ?? bankText,
      bankText: known?.bankText ?? bankText,
      accountName: known?.accountName ?? r.account.name,
      category: known?.category ?? r.category?.name ?? null,
    });
  }
  const nameOf = (key: string) => {
    const i = info.get(key) as ParcelInfo;
    return { title: i.label ?? i.title, bankText: i.bankText, accountName: i.accountName };
  };
  return { parcels, info, nameOf };
}

/**
 * As compras parceladas em andamento nas carteiras do escopo (M13.3a, Fixas e parcelas): as do
 * FinTrack e as que o banco informa ("2/5"), pela regra installmentsInProgress do core. Cada uma
 * com o nome, o cartão e a categoria. Recebido ainda não conferido também conta: a parcela já
 * está na fatura.
 */
export async function installmentPurchases(
  db: PrismaClient,
  scope: WalletScope<"view">,
  today: CivilDate,
) {
  if (scope.walletIds.length === 0) return [];
  const { parcels, info, nameOf } = await readParcels(db, scope.walletIds);
  return installmentsInProgress(parcels, today).map((p) => ({
    ...p,
    ...nameOf(p.key),
    category: (info.get(p.key) as ParcelInfo).category,
  }));
}

/** Uma parcela que ainda vai cair (ADR-027), com o que o previsto precisa para somá-la. */
export type InstallmentPlan = ForecastInstallment & {
  title: string;
  bankText: string;
  accountName: string;
  cardId: string | null;
};

/**
 * As parcelas previstas das compras parceladas do banco (e das que a pessoa disse): depois da
 * mais recente que já foi conferida, uma por fatura, até a última (projectedInstallments). A do
 * FinTrack não entra: todas as parcelas dela já estão gravadas. A parcela que chegou e está na
 * revisão ainda não conta (fora das somas, como a cobrança da recorrência do banco), então a
 * prevista dela continua. Só do mês de `today` em diante.
 */
export async function installmentPlans(
  db: PrismaClient,
  scope: WalletScope<"view">,
  today: CivilDate,
): Promise<InstallmentPlan[]> {
  if (scope.walletIds.length === 0) return [];
  const { parcels, nameOf } = await readParcels(db, scope.walletIds);
  const counted = parcels.filter((p) => !p.fromApp && !p.pending);
  const latest = new Map<string, (typeof counted)[number]>();
  for (const p of counted) {
    const seen = latest.get(p.key);
    if (!seen || p.number > seen.number) latest.set(p.key, p);
  }
  const current = monthOf(today);
  return projectedInstallments(counted)
    .filter((p) => p.month >= current)
    .map((p) => {
      const from = latest.get(p.key) as (typeof counted)[number];
      return {
        ...p,
        ...nameOf(p.key),
        walletId: from.walletId,
        accountId: from.accountId,
        accountKind: from.accountKind,
        cardId: from.cardId,
        categoryId: from.categoryId,
        payer: from.payer,
      };
    });
}

/**
 * "Parcelada" numa compra em que o banco não disse a parcela (ADR-027, O-Parcelada): a parcela e o
 * total vão para os campos da parcela do banco, marcados como ditos pela pessoa (a busca não
 * apaga). A compra deixa de ter fixa/variável (o CHECK) e sai da recorrência do banco; as que
 * faltam ficam previstas nas próximas faturas, e a cobrança do mês seguinte continua a parcela
 * sozinha. null desfaz (só a parcela que a pessoa disse). Auditoria com o id e os números.
 */
export async function setTransactionInstallment(
  db: PrismaClient,
  grant: TransactionGrant<"edit">,
  installment: { number: number; count: number } | null,
  ctx: RequestContext,
) {
  await db.$transaction((tx) => setInstallmentTx(tx, grant, installment, ctx));
}

/** setTransactionInstallment dentro de uma transação aberta. */
export async function setInstallmentTx(
  tx: Prisma.TransactionClient,
  grant: TransactionGrant<"edit">,
  installment: { number: number; count: number } | null,
  ctx: RequestContext,
) {
  if (installment && !statedInstallmentValid(installment)) {
    throw new DomainError("INSTALLMENT_NOT_ALLOWED");
  }
  const row = await tx.transaction.findFirst({
    where: { id: grant.transaction.id, deletedAt: null },
    select: {
      amount: true,
      transferId: true,
      reversalOfId: true,
      installmentGroupId: true,
      providerInstallmentCount: true,
      installmentByPerson: true,
      recurrence: { select: { origin: true } },
    },
  });
  if (!row) throw new DomainError("NOT_FOUND");
  const bankSaid = row.providerInstallmentCount !== null && !row.installmentByPerson;
  if (
    fromDbDecimal(row.amount) >= 0n ||
    row.transferId ||
    row.reversalOfId ||
    row.installmentGroupId ||
    bankSaid ||
    row.recurrence?.origin === "APP"
  ) {
    throw new DomainError("INSTALLMENT_NOT_ALLOWED");
  }
  if (!installment && !row.installmentByPerson) return;
  await tx.transaction.update({
    where: { id: grant.transaction.id },
    data: installment
      ? {
          providerInstallmentNumber: installment.number,
          providerInstallmentCount: installment.count,
          installmentByPerson: true,
          nature: null,
          recurrenceId: null,
        }
      : {
          providerInstallmentNumber: null,
          providerInstallmentCount: null,
          installmentByPerson: false,
        },
  });
  await writeAudit(
    tx,
    {
      actorId: grant.userId,
      householdId: grant.transaction.householdId,
      action: "transaction.installment_set",
      entity: "transaction",
      entityId: grant.transaction.id,
      metadata: installment
        ? { number: installment.number, count: installment.count }
        : { cleared: true },
    },
    ctx,
  );
}
