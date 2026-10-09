// Compra parcelada no cartão (M07.4, ADR-009): UMA compra vira N lançamentos, um por fatura,
// todos ligados ao mesmo grupo (InstallmentGroup) e numerados (1 de N, 2 de N...).
//
// O plano vem do core (installmentEntries): o valor de cada parcela, sem perder centavo (a sobra
// vai na 1ª), a fatura em que cada uma cai (pelo dia de fechamento do cartão) e o dia em que ela
// aparece na lista. As faturas que ainda não existem são criadas aqui, abertas. Tudo numa
// transação só: ou a compra entra inteira, ou não entra.
import {
  categorizedBy,
  dbDateFromCivil,
  installmentEntries,
  signedAmount,
  todayCivil,
  type Cents,
  type CivilDate,
  type PaymentMethod,
} from "@fintrack/core";
import { DomainError, type AccountGrant, type WalletGrant } from "./access";
import { writeAudit, type RequestContext } from "./audit";
import { assertUsableCategory, suggestCategory } from "./categories";
import type { PrismaClient } from "./generated/prisma/client";
import { toDbDecimal } from "./money";
import {
  recordCorrection,
  resolvePayment,
  sameHousehold,
  type CategorizationOptions,
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
          createdById: wallet.userId,
        },
        select: { id: true },
      });
      ids.push(created.id);
    }
    // A correção de categoria vale para a compra, não para cada parcela: um exemplo de treino
    await recordCorrection(
      tx,
      {
        householdId,
        transactionId: ids[0]!,
        description: input.description,
        kind: "expense",
        from: { categoryId: suggestion?.categoryId ?? null, source: suggestion?.source ?? null },
        to: categoryId,
        userId: wallet.userId,
      },
      options,
      ctx,
    );
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
