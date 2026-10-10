// Orçamento (M08): quanto cada ambiente planeja gastar por categoria em cada mês, e a parte de
// cada pessoa nesse valor (decisão do Danillo: "por ambiente e por pessoa").
//
// Crachás:
//   ler        WalletScope<"view"> (as carteiras que a pessoa vê; "Tudo que vejo" junta várias)
//   gravar     WalletGrant<"edit"> do ambiente (dono ou editor; leitor só vê)
//
// Regras do domínio (todas puras, no @fintrack/core, com teste):
//   - a divisão só existe em ambiente compartilhado, e a soma das partes é o valor (checkShares)
//   - uma categoria não é orçada junto com a de cima ou a de baixo (budgetLevelConflict)
//   - "copiar do mês anterior" só preenche o que falta, nunca sobrescreve (budgetsToCopy)
import {
  budgetLevelConflict,
  budgetsToCopy,
  checkShares,
  dbDateFromCivil,
  firstDayOf,
  monthOf,
  civilFromDbDate,
  SHARED_PAYER_PARAM,
  type BudgetRecord,
  type BudgetShare,
  type Cents,
  type MonthKey,
} from "@fintrack/core";
import { DomainError, type WalletGrant, type WalletScope } from "./access";
import { writeAudit, type RequestContext } from "./audit";
import { assertUsableCategory, categoryNodes } from "./categories";
import type { Prisma, PrismaClient } from "./generated/prisma/client";
import { fromDbDecimal, toDbDecimal } from "./money";

/** O maior valor que a tela aceita num orçado (R$ 9.999.999,99). */
export const MAX_BUDGET_CENTS: Cents = 999_999_999n;

const shareOf = (s: { userId: string | null; amount: Prisma.Decimal }): BudgetShare => ({
  payer: s.userId ?? SHARED_PAYER_PARAM,
  cents: fromDbDecimal(s.amount),
});

/** Os orçados das carteiras do escopo, de `from` a `to` (meses, inclusive), com a divisão. */
export async function listBudgets(
  db: PrismaClient | Prisma.TransactionClient,
  scope: WalletScope<"view">,
  from: MonthKey,
  to: MonthKey,
): Promise<BudgetRecord[]> {
  const rows = await db.budget.findMany({
    where: {
      walletId: { in: [...scope.walletIds] },
      month: { gte: dbDateFromCivil(firstDayOf(from)), lte: dbDateFromCivil(firstDayOf(to)) },
    },
    orderBy: [{ month: "asc" }, { id: "asc" }],
    select: {
      walletId: true,
      categoryId: true,
      month: true,
      amount: true,
      shares: { select: { userId: true, amount: true }, orderBy: { createdAt: "asc" } },
    },
  });
  return rows.map((b) => ({
    walletId: b.walletId,
    categoryId: b.categoryId,
    month: monthOf(civilFromDbDate(b.month)),
    cents: fromDbDecimal(b.amount),
    shares: b.shares.map(shareOf),
  }));
}

export type BudgetInput = {
  categoryId: string;
  month: MonthKey;
  cents: Cents;
  /** A divisão por quem paga ("compartilhado" ou o id da pessoa). Vazia = não dividido */
  shares: readonly BudgetShare[];
};

/** Confere a divisão contra o ambiente e o lar; devolve as linhas para gravar. */
async function sharesToRows(
  tx: Prisma.TransactionClient,
  grant: WalletGrant<"edit">,
  input: BudgetInput,
) {
  if (input.shares.length === 0) return [];
  if (grant.wallet.kind !== "SHARED") throw new DomainError("BUDGET_SHARES_PERSONAL");
  const problem = checkShares(input.cents, input.shares);
  if (problem) throw new DomainError(problem);
  const people = input.shares.filter((s) => s.payer !== SHARED_PAYER_PARAM).map((s) => s.payer);
  const members = await tx.householdMember.count({
    where: { householdId: grant.wallet.householdId, userId: { in: people } },
  });
  // Pessoa de fora do lar: a mesma resposta de um recurso que não existe
  if (members !== people.length) throw new DomainError("NOT_FOUND");
  return input.shares.map((s) => ({
    householdId: grant.wallet.householdId,
    userId: s.payer === SHARED_PAYER_PARAM ? null : s.payer,
    amount: toDbDecimal(s.cents),
  }));
}

/** Confere a regra do nível contra os orçados do mesmo ambiente e mês. */
async function assertLevel(
  tx: Prisma.TransactionClient,
  grant: WalletGrant<"edit">,
  categoryId: string,
  month: MonthKey,
) {
  const [nodes, budgeted] = await Promise.all([
    categoryNodes(tx, grant.wallet.householdId),
    tx.budget.findMany({
      where: { walletId: grant.wallet.id, month: dbDateFromCivil(firstDayOf(month)) },
      select: { categoryId: true },
    }),
  ]);
  const conflict = budgetLevelConflict(
    categoryId,
    budgeted.map((b) => b.categoryId),
    nodes,
  );
  if (conflict) throw new DomainError("BUDGET_LEVEL_CONFLICT", { conflictId: conflict });
}

/**
 * Grava (cria ou troca) o orçado de uma categoria num mês, com a divisão. Valor zero sem divisão
 * apaga o orçado (a categoria volta a "sem orçamento"). Tudo numa transação, com auditoria (só
 * ids, mês e quantas partes: nunca valores).
 */
export async function setBudget(
  db: PrismaClient,
  grant: WalletGrant<"edit">,
  input: BudgetInput,
  ctx: RequestContext,
) {
  if (input.cents < 0n || input.cents > MAX_BUDGET_CENTS) {
    throw new DomainError("BUDGET_AMOUNT_INVALID");
  }
  const month = dbDateFromCivil(firstDayOf(input.month));
  return db.$transaction(async (tx) => {
    await assertUsableCategory(tx, grant.wallet.householdId, input.categoryId, "expense");
    const key = {
      walletId_categoryId_month: { walletId: grant.wallet.id, categoryId: input.categoryId, month },
    };
    if (input.cents === 0n && input.shares.length === 0) {
      const removed = await tx.budget.deleteMany({
        where: { walletId: grant.wallet.id, categoryId: input.categoryId, month },
      });
      if (removed.count > 0) {
        await writeAudit(
          tx,
          {
            actorId: grant.userId,
            householdId: grant.wallet.householdId,
            action: "budget.removed",
            entity: "wallet",
            entityId: grant.wallet.id,
            metadata: { categoryId: input.categoryId, month: input.month },
          },
          ctx,
        );
      }
      return { removed: removed.count > 0 };
    }
    await assertLevel(tx, grant, input.categoryId, input.month);
    const shares = await sharesToRows(tx, grant, input);
    const budget = await tx.budget.upsert({
      where: key,
      create: {
        householdId: grant.wallet.householdId,
        walletId: grant.wallet.id,
        categoryId: input.categoryId,
        month,
        amount: toDbDecimal(input.cents),
      },
      update: { amount: toDbDecimal(input.cents) },
      select: { id: true },
    });
    await tx.budgetShare.deleteMany({ where: { budgetId: budget.id } });
    if (shares.length > 0) {
      await tx.budgetShare.createMany({
        data: shares.map((s) => ({ ...s, budgetId: budget.id })),
      });
    }
    await writeAudit(
      tx,
      {
        actorId: grant.userId,
        householdId: grant.wallet.householdId,
        action: "budget.set",
        entity: "wallet",
        entityId: grant.wallet.id,
        metadata: { categoryId: input.categoryId, month: input.month, shares: shares.length },
      },
      ctx,
    );
    return { removed: false };
  });
}

/**
 * "Copiar do mês anterior": os orçados (e as divisões) de `from` que ainda não existem em `to`,
 * no mesmo ambiente. Nunca sobrescreve. Copiar duas vezes não copia nada na segunda.
 * A divisão só é copiada se as pessoas ainda estão no lar (senão, copia o valor sem divisão).
 */
export async function copyBudgets(
  db: PrismaClient,
  grant: WalletGrant<"edit">,
  from: MonthKey,
  to: MonthKey,
  ctx: RequestContext,
) {
  return db.$transaction(async (tx) => {
    const walletId = grant.wallet.id;
    const [previous, current, nodes, members] = await Promise.all([
      tx.budget.findMany({
        where: { walletId, month: dbDateFromCivil(firstDayOf(from)) },
        orderBy: { id: "asc" },
        select: {
          categoryId: true,
          amount: true,
          category: { select: { archivedAt: true } },
          shares: { select: { userId: true, amount: true } },
        },
      }),
      tx.budget.findMany({
        where: { walletId, month: dbDateFromCivil(firstDayOf(to)) },
        select: { categoryId: true },
      }),
      categoryNodes(tx, grant.wallet.householdId),
      tx.householdMember.findMany({
        where: { householdId: grant.wallet.householdId },
        select: { userId: true },
      }),
    ]);
    const inHousehold = new Set(members.map((m) => m.userId));
    const lines = previous
      .filter((b) => b.category.archivedAt === null)
      .map((b) => {
        const shares = b.shares.map(shareOf);
        const valid =
          grant.wallet.kind === "SHARED" &&
          shares.every((s) => s.payer === SHARED_PAYER_PARAM || inHousehold.has(s.payer)) &&
          checkShares(fromDbDecimal(b.amount), shares) === null;
        return {
          categoryId: b.categoryId,
          cents: fromDbDecimal(b.amount),
          shares: valid ? shares : [],
        };
      });
    const { copy, kept } = budgetsToCopy(lines, current, nodes);
    for (const line of copy) {
      const created = await tx.budget.create({
        data: {
          householdId: grant.wallet.householdId,
          walletId,
          categoryId: line.categoryId,
          month: dbDateFromCivil(firstDayOf(to)),
          amount: toDbDecimal(line.cents),
        },
        select: { id: true },
      });
      if (line.shares.length > 0) {
        await tx.budgetShare.createMany({
          data: line.shares.map((s) => ({
            householdId: grant.wallet.householdId,
            budgetId: created.id,
            userId: s.payer === SHARED_PAYER_PARAM ? null : s.payer,
            amount: toDbDecimal(s.cents),
          })),
        });
      }
    }
    if (copy.length > 0) {
      await writeAudit(
        tx,
        {
          actorId: grant.userId,
          householdId: grant.wallet.householdId,
          action: "budgets.copied",
          entity: "wallet",
          entityId: grant.wallet.id,
          metadata: { from, to, copied: copy.length, kept },
        },
        ctx,
      );
    }
    return { copied: copy.length, kept, copiedCategoryIds: copy.map((c) => c.categoryId) };
  });
}

/**
 * O "Desfazer" da cópia: apaga do mês `to` só os orçados que a cópia criou (pela lista de
 * categorias que ela devolveu) e que ninguém mudou depois.
 */
export async function undoCopyBudgets(
  db: PrismaClient,
  grant: WalletGrant<"edit">,
  to: MonthKey,
  categoryIds: readonly string[],
  copiedAt: Date,
  ctx: RequestContext,
) {
  return db.$transaction(async (tx) => {
    const removed = await tx.budget.deleteMany({
      where: {
        walletId: grant.wallet.id,
        month: dbDateFromCivil(firstDayOf(to)),
        categoryId: { in: [...categoryIds] },
        updatedAt: { lte: copiedAt },
      },
    });
    if (removed.count > 0) {
      await writeAudit(
        tx,
        {
          actorId: grant.userId,
          householdId: grant.wallet.householdId,
          action: "budgets.copy_undone",
          entity: "wallet",
          entityId: grant.wallet.id,
          metadata: { to, removed: removed.count },
        },
        ctx,
      );
    }
    return { removed: removed.count };
  });
}
