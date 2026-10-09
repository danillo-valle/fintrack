// Recorrências (M07): aluguel, assinaturas, salário. Cada uma gera, no mês, um lançamento
// AGENDADO (SCHEDULED) que vira CONFIRMADO quando acontece.
//
// Gerar é idempotente: o lançamento do mês tem externalId "<id da recorrência>:<AAAA-MM>" e a
// chave única (accountId, source, externalId) do M04 recusa a cópia. Rodar duas vezes cria zero
// lançamentos novos. No M09 a fila (pg-boss) chama a mesma função todo dia 1º; no M07 é um botão.
import {
  allowedMethods,
  civilFromDbDate,
  compareCivil,
  dbDateFromCivil,
  defaultMethod,
  methodAllowsCard,
  monthOf,
  occurrenceIn,
  recurrenceExternalId,
  signedAmount,
  todayCivil,
  type Cents,
  type CivilDate,
  type MonthKey,
  type PaymentMethod,
} from "@fintrack/core";
import { DomainError, type AccountGrant, type WalletGrant, type WalletScope } from "./access";
import { writeAudit, type RequestContext } from "./audit";
import { assertUsableCategory } from "./categories";
import type { Prisma, PrismaClient } from "./generated/prisma/client";
import { fromDbDecimal, toDbDecimal } from "./money";

export type RecurrenceKindInput = "FIXED_BILL" | "SUBSCRIPTION" | "INCOME";

export type RecurrenceInput = {
  kind: RecurrenceKindInput;
  description: string;
  /** Positivo: o tipo decide o sinal (receita entra, conta e assinatura saem) */
  cents: Cents;
  dayOfMonth: number;
  startsOn: CivilDate;
  endsOn?: CivilDate | null;
  categoryId?: string | null;
  method?: PaymentMethod | null;
  cardId?: string | null;
};

/** Forma de pagamento e cartão da recorrência, conferidos contra a conta (como no lançamento). */
function resolveRecurrencePayment(account: AccountGrant, input: RecurrenceInput) {
  const kind = input.kind === "INCOME" ? "income" : "expense";
  const method = input.method ?? defaultMethod(account.account.kind, kind);
  if (!allowedMethods(account.account.kind).includes(method)) {
    throw new DomainError("METHOD_NOT_ALLOWED");
  }
  const cardId = input.cardId || (account.via === "CARD" ? (account.cardIds[0] ?? null) : null);
  if (cardId && (!account.cardIds.includes(cardId) || !methodAllowsCard(method))) {
    throw new DomainError("CARD_NOT_ALLOWED");
  }
  return { kind, method, cardId } as const;
}

/** Grava a recorrência e a auditoria, dentro de uma transação que já está aberta. */
async function insertRecurrence(
  tx: Prisma.TransactionClient,
  wallet: WalletGrant<"edit">,
  account: AccountGrant,
  input: RecurrenceInput,
  ctx: RequestContext,
) {
  const { kind, method, cardId } = resolveRecurrencePayment(account, input);
  const categoryId = await assertUsableCategory(
    tx,
    wallet.wallet.householdId,
    input.categoryId ?? null,
    kind,
  );
  const recurrence = await tx.recurrence.create({
    data: {
      householdId: wallet.wallet.householdId,
      walletId: wallet.wallet.id,
      accountId: account.account.id,
      cardId,
      categoryId,
      kind: input.kind,
      method,
      description: input.description,
      amount: toDbDecimal(signedAmount(kind, input.cents)),
      dayOfMonth: input.dayOfMonth,
      startsOn: dbDateFromCivil(input.startsOn),
      endsOn: input.endsOn ? dbDateFromCivil(input.endsOn) : null,
      createdById: wallet.userId,
    },
  });
  await writeAudit(
    tx,
    {
      actorId: wallet.userId,
      householdId: wallet.wallet.householdId,
      action: "recurrence.created",
      entity: "recurrence",
      entityId: recurrence.id,
      metadata: { kind: input.kind, walletId: wallet.wallet.id },
    },
    ctx,
  );
  return recurrence;
}

export async function createRecurrence(
  db: PrismaClient,
  wallet: WalletGrant<"edit">,
  account: AccountGrant,
  input: RecurrenceInput,
  ctx: RequestContext,
) {
  if (wallet.wallet.householdId !== account.account.householdId) throw new DomainError("NOT_FOUND");
  resolveRecurrencePayment(account, input); // recusa antes de abrir a transação
  return db.$transaction((tx) => insertRecurrence(tx, wallet, account, input, ctx));
}

export type FixedExpenseInput = Omit<RecurrenceInput, "kind" | "startsOn"> & {
  kind: "FIXED_BILL" | "SUBSCRIPTION";
  /** O dia do lançamento deste mês (a recorrência começa nele) */
  occurredOn: CivilDate;
  notes?: string | null;
};

/**
 * "Fixa" no novo lançamento (M07.4): cria a recorrência E o lançamento deste mês, numa transação
 * só. O lançamento já leva o externalId do mês ("<recorrência>:<AAAA-MM>"), então "Lançar as
 * deste mês" (e, no M09, a fila do dia 1º) não duplica: a chave única do M04 descarta a cópia.
 * Os meses seguintes saem da recorrência; nada é gravado adiantado.
 */
export async function createFixedExpense(
  db: PrismaClient,
  wallet: WalletGrant<"edit">,
  account: AccountGrant,
  input: FixedExpenseInput,
  ctx: RequestContext,
  today: CivilDate = todayCivil(),
) {
  if (wallet.wallet.householdId !== account.account.householdId) throw new DomainError("NOT_FOUND");
  const recurrenceInput: RecurrenceInput = { ...input, startsOn: input.occurredOn };
  resolveRecurrencePayment(account, recurrenceInput);
  return db.$transaction(async (tx) => {
    const recurrence = await insertRecurrence(tx, wallet, account, recurrenceInput, ctx);
    const transaction = await tx.transaction.create({
      data: {
        householdId: recurrence.householdId,
        walletId: recurrence.walletId,
        accountId: recurrence.accountId,
        cardId: recurrence.cardId,
        categoryId: recurrence.categoryId,
        categorizedBy: recurrence.categoryId ? "MANUAL" : null,
        method: recurrence.method,
        amount: recurrence.amount,
        occurredOn: dbDateFromCivil(input.occurredOn),
        description: input.description,
        notes: input.notes ?? null,
        status: compareCivil(input.occurredOn, today) <= 0 ? "CONFIRMED" : "SCHEDULED",
        source: "RECURRENCE",
        externalId: recurrenceExternalId(recurrence.id, monthOf(input.occurredOn)),
        recurrenceId: recurrence.id,
        createdById: wallet.userId,
      },
      select: { id: true },
    });
    return { recurrenceId: recurrence.id, transactionId: transaction.id };
  });
}

/** As recorrências das carteiras que a pessoa vê, ativas primeiro. */
export async function listRecurrences(db: PrismaClient, scope: WalletScope<"view">) {
  const rows = await db.recurrence.findMany({
    where: { walletId: { in: [...scope.walletIds] } },
    orderBy: [{ archivedAt: { sort: "asc", nulls: "first" } }, { dayOfMonth: "asc" }],
    select: {
      id: true,
      kind: true,
      description: true,
      amount: true,
      dayOfMonth: true,
      startsOn: true,
      endsOn: true,
      archivedAt: true,
      walletId: true,
      wallet: { select: { name: true } },
      account: { select: { name: true } },
      category: { select: { name: true } },
    },
  });
  return rows.map((r) => ({
    ...r,
    amount: fromDbDecimal(r.amount),
    startsOn: civilFromDbDate(r.startsOn),
    endsOn: r.endsOn ? civilFromDbDate(r.endsOn) : null,
  }));
}

/** Arquiva (encerra) uma recorrência da carteira. Os lançamentos já gerados continuam. */
export async function archiveRecurrence(
  db: PrismaClient,
  wallet: WalletGrant<"edit">,
  recurrenceId: string,
  ctx: RequestContext,
) {
  await db.$transaction(async (tx) => {
    // walletId no filtro: o id veio do formulário (IDOR)
    const { count } = await tx.recurrence.updateMany({
      where: { id: recurrenceId, walletId: wallet.wallet.id, archivedAt: null },
      data: { archivedAt: new Date() },
    });
    if (count === 0) throw new DomainError("NOT_FOUND");
    await writeAudit(
      tx,
      {
        actorId: wallet.userId,
        householdId: wallet.wallet.householdId,
        action: "recurrence.archived",
        entity: "recurrence",
        entityId: recurrenceId,
      },
      ctx,
    );
  });
}

/**
 * Gera os lançamentos agendados do mês para as recorrências ativas das carteiras em que a
 * pessoa pode lançar. Devolve quantos foram criados (zero na segunda vez: idempotente).
 */
export async function generateRecurrences(
  db: PrismaClient,
  scope: WalletScope<"edit">,
  month: MonthKey,
  ctx: RequestContext,
) {
  if (!scope.householdId || scope.walletIds.length === 0) return { created: 0 };
  const householdId = scope.householdId;
  const recurrences = await db.recurrence.findMany({
    where: {
      walletId: { in: [...scope.walletIds] },
      archivedAt: null,
      account: { archivedAt: null },
    },
  });
  const rows = recurrences.flatMap((r) => {
    const date = occurrenceIn(
      {
        id: r.id,
        dayOfMonth: r.dayOfMonth,
        startsOn: civilFromDbDate(r.startsOn),
        endsOn: r.endsOn ? civilFromDbDate(r.endsOn) : null,
      },
      month,
    );
    if (!date) return [];
    return [
      {
        householdId: r.householdId,
        walletId: r.walletId,
        accountId: r.accountId,
        cardId: r.cardId,
        categoryId: r.categoryId,
        // A pessoa escolheu a categoria ao criar a recorrência
        categorizedBy: r.categoryId ? ("MANUAL" as const) : null,
        method: r.method,
        amount: r.amount,
        occurredOn: dbDateFromCivil(date),
        description: r.description,
        status: "SCHEDULED" as const,
        source: "RECURRENCE" as const,
        externalId: recurrenceExternalId(r.id, month),
        recurrenceId: r.id,
      },
    ];
  });
  return db.$transaction(async (tx) => {
    // skipDuplicates = ON CONFLICT DO NOTHING: a chave única descarta o que já foi gerado
    const { count } = await tx.transaction.createMany({ data: rows, skipDuplicates: true });
    if (count > 0) {
      await writeAudit(
        tx,
        {
          actorId: scope.userId,
          householdId,
          action: "recurrences.generated",
          entity: "recurrence",
          entityId: month,
          metadata: { month, created: count },
        },
        ctx,
      );
    }
    return { created: count };
  });
}
