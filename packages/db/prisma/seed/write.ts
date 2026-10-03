// Grava o plano do seed no banco, numa transação só: ou entra tudo, ou nada.
//
// Antes de gravar, apaga o grupo do seed anterior (pelo id fixo) e as duas pessoas fictícias.
// O resto vai junto em cascata. Assim, rodar o seed duas vezes não duplica nada.
import { dbDateFromCivil, firstDayOf, type Cents } from "@fintrack/core";
import type { PrismaClient } from "../../src/generated/prisma/client";
import { toDbDecimal } from "../../src/money";
import { SEED_USER_IDS, type SeedPlan } from "./plan";

const orNull = (cents: Cents | null) => (cents === null ? null : toDbDecimal(cents));

export async function writeSeedPlan(prisma: PrismaClient, plan: SeedPlan): Promise<void> {
  const householdId = plan.household.id;
  await prisma.$transaction(
    async (tx) => {
      // 1. Limpa a versão anterior (a cascata do banco apaga ambientes, contas, lançamentos...)
      await tx.household.deleteMany({ where: { id: householdId } });
      await tx.user.deleteMany({ where: { id: { in: [...SEED_USER_IDS] } } });

      // 2. Pessoas, grupo e ambientes (os membros do ambiente precisam ser do grupo)
      await tx.user.createMany({
        data: plan.users.map((u) => ({ ...u, emailVerified: true })),
      });
      await tx.household.create({
        data: {
          ...plan.household,
          members: {
            create: plan.users.map((u, i) => ({
              userId: u.id,
              role: i === 0 ? "OWNER" : "MEMBER",
            })),
          },
        },
      });
      await tx.wallet.createMany({
        data: plan.wallets.map((w) => ({
          id: w.id,
          householdId,
          name: w.name,
          kind: w.kind,
          createdById: w.createdById,
        })),
      });
      await tx.walletMember.createMany({
        data: plan.wallets.flatMap((w) =>
          w.members.map((m) => ({ householdId, walletId: w.id, ...m })),
        ),
      });

      // 3. Contas, cartões (só os 4 últimos dígitos), categorias (pais antes das filhas) e regras
      await tx.financialAccount.createMany({
        data: plan.accounts.map((a) => ({
          id: a.id,
          householdId,
          walletId: a.walletId,
          holderId: a.holderId,
          name: a.name,
          kind: a.kind,
          institution: a.institution,
          initialBalance: toDbDecimal(a.initialBalance),
          creditLimit: orNull(a.creditLimit),
          closingDay: a.cycle?.closingDay ?? null,
          dueDay: a.cycle?.dueDay ?? null,
        })),
      });
      await tx.paymentCard.createMany({ data: plan.cards });
      for (const level of [
        plan.categories.filter((c) => !c.parentId),
        plan.categories.filter((c) => c.parentId),
      ]) {
        await tx.category.createMany({
          data: level.map((c) => ({ ...c, householdId })),
        });
      }
      await tx.categoryRule.createMany({
        data: plan.rules.map((r) => ({ ...r, householdId })),
      });

      // 4. Orçamentos, recorrências, faturas e compras parceladas
      await tx.budget.createMany({
        data: plan.budgets.map((b) => ({
          ...b,
          householdId,
          month: dbDateFromCivil(firstDayOf(b.month)),
          amount: toDbDecimal(b.amount),
        })),
      });
      await tx.recurrence.createMany({
        data: plan.recurrences.map((r) => ({
          ...r,
          householdId,
          amount: toDbDecimal(r.amount),
          startsOn: dbDateFromCivil(r.startsOn),
        })),
      });
      await tx.cardStatement.createMany({
        data: plan.statements.map((s) => ({
          id: s.id,
          accountId: s.accountId,
          referenceMonth: dbDateFromCivil(firstDayOf(s.referenceMonth)),
          closingDate: dbDateFromCivil(s.closingDate),
          dueDate: dbDateFromCivil(s.dueDate),
          total: orNull(s.total),
          status: s.status,
          source: "OPEN_FINANCE",
          externalId: `seed-bill-${s.id.slice(-6)}`,
        })),
      });
      await tx.installmentGroup.createMany({
        data: plan.installmentGroups.map((g) => ({
          ...g,
          householdId,
          totalAmount: toDbDecimal(g.totalAmount),
          purchasedOn: dbDateFromCivil(g.purchasedOn),
        })),
      });

      // 5. Lançamentos. Os estornos vão depois: eles apontam para a compra original.
      const toRow = (t: SeedPlan["transactions"][number]) => ({
        ...t,
        householdId,
        amount: toDbDecimal(t.amount),
        occurredOn: dbDateFromCivil(t.occurredOn),
      });
      await tx.transaction.createMany({
        data: plan.transactions.filter((t) => !t.reversalOfId).map(toRow),
      });
      await tx.transaction.createMany({
        data: plan.transactions.filter((t) => t.reversalOfId).map(toRow),
      });

      // 6. Registro na trilha de auditoria: até o seed deixa rastro
      await tx.auditLog.create({
        data: {
          action: "seed.loaded",
          entity: "household",
          entityId: householdId,
          householdId,
          metadata: {
            transactions: plan.transactions.length,
            statements: plan.statements.length,
            cards: plan.cards.length,
            recurrences: plan.recurrences.length,
          },
        },
      });
    },
    // Uma transação grande: o padrão do Prisma (5 s) é curto para alguns milhares de linhas
    { timeout: 60_000, maxWait: 10_000 },
  );
}
