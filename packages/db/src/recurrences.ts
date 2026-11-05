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
  expectedAmount,
  methodAllowsCard,
  monthOf,
  occurrenceIn,
  recurrenceExternalId,
  recurrenceSettingsValid,
  signedAmount,
  todayCivil,
  type Cents,
  type CivilDate,
  type MonthKey,
  type PaymentMethod,
  type RecurrenceOrigin,
  type RecurrenceSettings,
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

/** Quantas cobranças que chegaram a lista mostra de cada recorrência do banco ("Os últimos"). */
export const LAST_ARRIVALS = 3;

/** As cobranças ligadas que contam (conferidas e não excluídas), da mais recente para a mais antiga. */
export const ARRIVALS_INCLUDE = {
  where: { status: "CONFIRMED", deletedAt: null },
  orderBy: [{ occurredOn: "desc" }, { id: "desc" }],
  take: 12,
  select: { occurredOn: true, amount: true },
} satisfies Prisma.Recurrence$transactionsArgs;

/**
 * As recorrências das carteiras que a pessoa vê, ativas primeiro (Fixas e parcelas, ADR-027): a
 * regra do valor e do dia, o valor previsto (expectedAmount) e, na do banco, as últimas cobranças
 * que chegaram.
 */
export async function listRecurrences(db: PrismaClient, scope: WalletScope<"view">) {
  const rows = await db.recurrence.findMany({
    where: { walletId: { in: [...scope.walletIds] } },
    orderBy: [{ archivedAt: { sort: "asc", nulls: "first" } }, { dayOfMonth: "asc" }],
    select: {
      id: true,
      kind: true,
      origin: true,
      amountRule: true,
      dayRule: true,
      description: true,
      amount: true,
      dayOfMonth: true,
      startsOn: true,
      endsOn: true,
      archivedAt: true,
      walletId: true,
      wallet: { select: { name: true } },
      account: { select: { name: true, kind: true } },
      card: { select: { lastFour: true } },
      category: { select: { name: true } },
      transactions: ARRIVALS_INCLUDE,
    },
  });
  return rows.map(({ transactions, ...r }) => {
    const fixed = fromDbDecimal(r.amount);
    const arrivals = transactions.map((t) => ({
      occurredOn: civilFromDbDate(t.occurredOn),
      amount: fromDbDecimal(t.amount),
    }));
    return {
      ...r,
      amount: fixed,
      expected: r.origin === "BANK" ? expectedAmount(r.amountRule, fixed, arrivals) : fixed,
      /** O valor (positivo) que cada regra daria agora: a escolha de Mudar o valor */
      previews:
        r.origin === "BANK"
          ? {
              LAST: absCents(expectedAmount("LAST", fixed, arrivals)),
              AVERAGE_3: absCents(expectedAmount("AVERAGE_3", fixed, arrivals)),
            }
          : {},
      lastArrivals: r.origin === "BANK" ? arrivals.slice(0, LAST_ARRIVALS) : [],
      startsOn: civilFromDbDate(r.startsOn),
      endsOn: r.endsOn ? civilFromDbDate(r.endsOn) : null,
    };
  });
}

const absCents = (c: bigint) => (c < 0n ? -c : c);

/** A recorrência a mudar: só os campos que a regra do valor e do dia precisam. */
export type SettingsTarget = {
  id: string;
  kind: RecurrenceKindInput;
  origin: RecurrenceOrigin;
  startsOn: Date;
};

/**
 * Grava o valor e o dia de uma recorrência (Repete todo mês e Mudar o valor), dentro de uma
 * transação aberta. Recusa a regra que não vale (recurrenceSettingsValid, os mesmos limites dos
 * CHECKs). Valor fixo: o tipo dá o sinal. Auditoria com a regra e o dia, nunca o valor.
 */
export async function applyRecurrenceSettings(
  tx: Prisma.TransactionClient,
  target: SettingsTarget,
  settings: RecurrenceSettings,
  audit: { actorId: string; householdId: string },
  ctx: RequestContext,
) {
  if (!recurrenceSettingsValid(target.origin, civilFromDbDate(target.startsOn), settings)) {
    throw new DomainError("RECURRENCE_RULE_INVALID");
  }
  const kind = target.kind === "INCOME" ? "income" : "expense";
  await tx.recurrence.update({
    where: { id: target.id },
    data: {
      amountRule: settings.amountRule,
      dayRule: settings.dayRule,
      dayOfMonth: settings.day,
      endsOn: settings.endsOn ? dbDateFromCivil(settings.endsOn) : null,
      ...(settings.fixed !== null
        ? { amount: toDbDecimal(signedAmount(kind, settings.fixed)) }
        : {}),
    },
  });
  await writeAudit(
    tx,
    {
      actorId: audit.actorId,
      householdId: audit.householdId,
      action: "recurrence.updated",
      entity: "recurrence",
      entityId: target.id,
      metadata: {
        amountRule: settings.amountRule,
        dayRule: settings.dayRule,
        day: settings.day,
        ends: settings.endsOn !== null,
      },
    },
    ctx,
  );
}

/** Mudar o valor (Fixas e parcelas, ⋯): a regra do valor, o dia e o fim de uma recorrência ativa. */
export async function updateRecurrence(
  db: PrismaClient,
  wallet: WalletGrant<"edit">,
  recurrenceId: string,
  settings: RecurrenceSettings,
  ctx: RequestContext,
) {
  await db.$transaction(async (tx) => {
    // walletId no filtro: o id veio do formulário (IDOR)
    const target = await tx.recurrence.findFirst({
      where: { id: recurrenceId, walletId: wallet.wallet.id, archivedAt: null },
      select: { id: true, kind: true, origin: true, startsOn: true },
    });
    if (!target) throw new DomainError("NOT_FOUND");
    await applyRecurrenceSettings(
      tx,
      target,
      settings,
      { actorId: wallet.userId, householdId: wallet.wallet.householdId },
      ctx,
    );
  });
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
      // A do banco só prevê (ADR-027): a cobrança que chega é o lançamento
      origin: "APP",
      account: { archivedAt: null },
    },
  });
  const rows = recurrences.flatMap((r) => {
    const date = occurrenceIn(
      {
        id: r.id,
        dayOfMonth: r.dayOfMonth,
        dayRule: r.dayRule,
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
