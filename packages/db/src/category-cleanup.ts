// A limpeza das categorias que eram transferência (M13.3b, ADR-026, canvas N-Limpeza). A regra de
// qual categoria aparece e de quais lançamentos formam par é pura (cleanupCandidates e planCleanup,
// @fintrack/core); aqui o banco: os lançamentos que entram, a conversão numa transação só, com o
// antes de cada um guardado em `category_cleanup`, e o Desfazer de 30 minutos.
//
// Só entram lançamentos confirmados, dos últimos 6 meses, das carteiras que a pessoa EDITA (os dois
// lados de cada par). A auditoria leva só ids e contagens: nunca valor nem descrição.
import { randomUUID } from "node:crypto";
import {
  civilFromDbDate,
  cleanupCandidates,
  cleanupSince,
  dbDateFromCivil,
  planCleanup,
  type CivilDate,
  type CleanupPlan,
  type CleanupRow,
} from "@fintrack/core";
import { DomainError, type HouseholdGrant, type WalletScope } from "./access";
import { writeAudit, type RequestContext } from "./audit";
import { linkRecurring } from "./recurring";
import { Prisma, type PrismaClient } from "./generated/prisma/client";
import { CategorizationSource, ExpenseNature, TransferPeer } from "./generated/prisma/enums";
import { fromDbDecimal } from "./money";

/** Por quanto tempo o Desfazer de uma limpeza vale. */
export const CLEANUP_UNDO_MINUTES = 30;

const ROW_SELECT = {
  id: true,
  accountId: true,
  amount: true,
  occurredOn: true,
  categoryId: true,
  installmentGroupId: true,
  providerInstallmentCount: true,
  reversalOfId: true,
  account: { select: { kind: true } },
} satisfies Prisma.TransactionSelect;

type Row = Prisma.TransactionGetPayload<{ select: typeof ROW_SELECT }>;

function toCleanupRow(r: Row): CleanupRow {
  return {
    id: r.id,
    accountId: r.accountId,
    accountKind: r.account.kind,
    amount: fromDbDecimal(r.amount),
    occurredOn: civilFromDbDate(r.occurredOn),
    categoryId: r.categoryId,
    locked: Boolean(r.installmentGroupId || r.providerInstallmentCount || r.reversalOfId),
  };
}

function householdOf(grant: HouseholdGrant<"manage_categories">, scope: WalletScope<"edit">) {
  if (scope.householdId !== grant.household.id || scope.userId !== grant.userId) {
    throw new DomainError("NOT_FOUND");
  }
  return grant.household.id;
}

/** Os lançamentos que a limpeza olha: confirmados, sem transferência, das carteiras editáveis. */
async function cleanupRows(
  db: PrismaClient | Prisma.TransactionClient,
  scope: WalletScope<"edit">,
  today: CivilDate,
): Promise<CleanupRow[]> {
  const rows = await db.transaction.findMany({
    where: {
      walletId: { in: [...scope.walletIds] },
      status: "CONFIRMED",
      deletedAt: null,
      transferId: null,
      occurredOn: { gte: dbDateFromCivil(cleanupSince(today)), lte: dbDateFromCivil(today) },
    },
    select: ROW_SELECT,
  });
  return rows.map(toCleanupRow);
}

const DETAIL_SELECT = {
  id: true,
  amount: true,
  occurredOn: true,
  description: true,
  label: true,
  categoryId: true,
  account: { select: { name: true } },
} satisfies Prisma.TransactionSelect;

type Detail = Prisma.TransactionGetPayload<{ select: typeof DETAIL_SELECT }>;

function detailView(d: Detail) {
  return {
    id: d.id,
    amount: fromDbDecimal(d.amount),
    occurredOn: civilFromDbDate(d.occurredOn),
    name: d.label ?? d.description,
    accountName: d.account.name,
    categoryId: d.categoryId,
  };
}

export type CleanupLine = ReturnType<typeof detailView>;

/**
 * As categorias que parecem de transferência, com o que a pessoa revisa antes de confirmar: cada
 * par (a saída e a entrada) e os que ficam de um lado só.
 */
export async function findCleanups(
  db: PrismaClient,
  grant: HouseholdGrant<"manage_categories">,
  scope: WalletScope<"edit">,
  today: CivilDate,
) {
  const householdId = householdOf(grant, scope);
  const rows = await cleanupRows(db, scope, today);
  const candidates = cleanupCandidates(rows);
  if (candidates.length === 0) return [];
  const ids = new Set(
    candidates.flatMap((c) => [...c.pairs.flatMap((p) => [p.outId, p.inId]), ...c.oneSided]),
  );
  const [details, categories] = await Promise.all([
    db.transaction.findMany({ where: { id: { in: [...ids] } }, select: DETAIL_SELECT }),
    db.category.findMany({
      where: { householdId, id: { in: candidates.map((c) => c.categoryId) } },
      select: { id: true, name: true, kind: true },
    }),
  ]);
  const byId = new Map(details.map((d) => [d.id, detailView(d)]));
  const line = (id: string) => byId.get(id) as CleanupLine;
  const names = new Map(categories.map((c) => [c.id, c]));
  return candidates.flatMap((c) => {
    const category = names.get(c.categoryId);
    if (!category) return [];
    return [
      {
        category,
        count: c.members,
        paired: c.paired,
        pairs: c.pairs.map((p) => ({
          out: line(p.outId),
          in: line(p.inId),
          daysApart: p.daysApart,
          billPayment: p.billPayment,
        })),
        oneSided: c.oneSided.map(line),
      },
    ];
  });
}

export type CategoryCleanupView = Awaited<ReturnType<typeof findCleanups>>[number];

/** Como cada lançamento estava antes da limpeza, e o transferId que ganhou. */
type CleanupBefore = {
  id: string;
  categoryId: string | null;
  categorizedBy: CategorizationSource | null;
  categorizationConfidence: number | null;
  nature: ExpenseNature | null;
  transferId: string | null;
  transferPeer: TransferPeer | null;
  /** A recorrência do banco que ele realizava (ADR-027): a transferência sai dela */
  recurrenceId: string | null;
  /** O transferId que a limpeza deu: o Desfazer só mexe se ele ainda estiver lá */
  cleanedTransferId: string;
};

/** O transferId de cada lançamento do plano: o mesmo para os dois lados do par. */
function transferIdsOf(plan: CleanupPlan): Map<string, { transferId: string; external: boolean }> {
  const ids = new Map<string, { transferId: string; external: boolean }>();
  for (const pair of plan.pairs) {
    const transferId = randomUUID();
    ids.set(pair.outId, { transferId, external: false });
    ids.set(pair.inId, { transferId, external: false });
  }
  for (const id of plan.oneSided) ids.set(id, { transferId: randomUUID(), external: true });
  return ids;
}

/**
 * "Tratar os N como transferência": recalcula o plano aqui (não confia na tela) e confere que
 * ainda são os N que a pessoa viu (senão REVIEW_STALE). Cada par ganha o mesmo transferId, o de um
 * lado só ganha `transferPeer EXTERNAL`; todos perdem a categoria e a marca fixa/variável. Com
 * `archive`, a categoria é arquivada junto. Devolve o id da limpeza (para o Desfazer).
 */
export async function applyCleanup(
  db: PrismaClient,
  grant: HouseholdGrant<"manage_categories">,
  scope: WalletScope<"edit">,
  input: { categoryId: string; expectedCount: number; archive: boolean },
  ctx: RequestContext,
  today: CivilDate,
) {
  const householdId = householdOf(grant, scope);
  return db.$transaction(async (tx) => {
    const category = await tx.category.findFirst({
      where: { id: input.categoryId, householdId },
      select: {
        id: true,
        archivedAt: true,
        _count: { select: { children: { where: { archivedAt: null } } } },
      },
    });
    if (!category) throw new DomainError("NOT_FOUND");
    if (input.archive && category._count.children > 0) {
      throw new DomainError("CATEGORY_IN_USE_AS_PARENT");
    }
    const plan = planCleanup(input.categoryId, await cleanupRows(tx, scope, today));
    const transfers = transferIdsOf(plan);
    if (transfers.size === 0) throw new DomainError("CLEANUP_NOT_NEEDED");
    if (plan.members !== input.expectedCount) throw new DomainError("REVIEW_STALE");

    const current = await tx.transaction.findMany({
      where: { id: { in: [...transfers.keys()] } },
      select: {
        id: true,
        categoryId: true,
        categorizedBy: true,
        categorizationConfidence: true,
        nature: true,
        transferId: true,
        transferPeer: true,
        recurrenceId: true,
      },
    });
    const before: CleanupBefore[] = current.map((t) => ({
      ...t,
      cleanedTransferId: (transfers.get(t.id) as { transferId: string }).transferId,
    }));
    for (const [id, { transferId, external }] of transfers) {
      const { count } = await tx.transaction.updateMany({
        where: { id, deletedAt: null, status: "CONFIRMED", transferId: null },
        data: {
          transferId,
          transferPeer: external ? "EXTERNAL" : null,
          categoryId: null,
          categorizedBy: null,
          categorizationConfidence: null,
          nature: null,
        },
      });
      if (count === 0) throw new DomainError("REVIEW_STALE");
    }
    // Transferência não se repete: sai da recorrência do banco (ADR-027)
    await linkRecurring(tx, [...transfers.keys()], grant.userId, ctx);
    const archived = input.archive && category.archivedAt === null;
    if (archived) {
      await tx.category.update({ where: { id: category.id }, data: { archivedAt: new Date() } });
    }
    const cleanup = await tx.categoryCleanup.create({
      data: {
        householdId,
        categoryId: category.id,
        transactionCount: transfers.size,
        archived,
        before,
        createdById: grant.userId,
      },
      select: { id: true },
    });
    await writeAudit(
      tx,
      {
        actorId: grant.userId,
        householdId,
        action: "category.cleanup",
        entity: "category",
        entityId: category.id,
        metadata: {
          cleanupId: cleanup.id,
          pairs: plan.pairs.length,
          oneSided: plan.oneSided.length,
          archived,
        },
      },
      ctx,
    );
    return { cleanupId: cleanup.id, count: transfers.size, archived };
  });
}

/** O valor guardado, se for um dos do enum; senão nulo. */
function oneOf<T extends string>(values: Record<string, T>, value: string | null): T | null {
  return Object.values(values).find((v) => v === value) ?? null;
}

function parseBefore(value: Prisma.JsonValue): CleanupBefore[] {
  if (!Array.isArray(value)) throw new DomainError("UNDO_EXPIRED");
  return value.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new DomainError("UNDO_EXPIRED");
    }
    const v = item as Record<string, unknown>;
    const str = (k: string) => (typeof v[k] === "string" ? (v[k] as string) : null);
    const id = str("id");
    const cleanedTransferId = str("cleanedTransferId");
    if (!id || !cleanedTransferId) throw new DomainError("UNDO_EXPIRED");
    return {
      id,
      categoryId: str("categoryId"),
      categorizedBy: oneOf(CategorizationSource, str("categorizedBy")),
      categorizationConfidence:
        typeof v.categorizationConfidence === "number" ? v.categorizationConfidence : null,
      nature: oneOf(ExpenseNature, str("nature")),
      transferId: str("transferId"),
      transferPeer: oneOf(TransferPeer, str("transferPeer")),
      recurrenceId: str("recurrenceId"),
      cleanedTransferId,
    };
  });
}

/**
 * Desfaz uma limpeza nos 30 minutos seguintes: cada lançamento volta como estava (a categoria, a
 * marca e quem decidiu) e a categoria arquivada junto volta a ficar ativa. Se algum lançamento
 * mudou depois (outra pessoa desfez a transferência, ou ele foi apagado), UNDO_EXPIRED.
 */
export async function undoCleanup(
  db: PrismaClient,
  grant: HouseholdGrant<"manage_categories">,
  scope: WalletScope<"edit">,
  cleanupId: string,
  ctx: RequestContext,
  now: Date = new Date(),
) {
  const householdId = householdOf(grant, scope);
  await db.$transaction(async (tx) => {
    const cleanup = await tx.categoryCleanup.findFirst({
      where: { id: cleanupId, householdId },
      select: {
        id: true,
        categoryId: true,
        archived: true,
        before: true,
        createdAt: true,
        undoneAt: true,
      },
    });
    if (!cleanup) throw new DomainError("NOT_FOUND");
    const expired = now.getTime() - cleanup.createdAt.getTime() > CLEANUP_UNDO_MINUTES * 60_000;
    if (cleanup.undoneAt || expired) throw new DomainError("UNDO_EXPIRED");
    const editable = [...scope.walletIds];
    for (const before of parseBefore(cleanup.before)) {
      const { count } = await tx.transaction.updateMany({
        where: {
          id: before.id,
          walletId: { in: editable },
          deletedAt: null,
          transferId: before.cleanedTransferId,
        },
        data: {
          transferId: before.transferId,
          transferPeer: before.transferPeer,
          recurrenceId: before.recurrenceId,
          categoryId: before.categoryId,
          categorizedBy: before.categorizedBy,
          categorizationConfidence: before.categorizationConfidence,
          nature: before.nature,
        },
      });
      if (count === 0) throw new DomainError("UNDO_EXPIRED");
    }
    if (cleanup.archived) {
      await tx.category.update({ where: { id: cleanup.categoryId }, data: { archivedAt: null } });
    }
    await tx.categoryCleanup.update({ where: { id: cleanup.id }, data: { undoneAt: now } });
    await writeAudit(
      tx,
      {
        actorId: grant.userId,
        householdId,
        action: "category.cleanup_undone",
        entity: "category",
        entityId: cleanup.categoryId,
        metadata: { cleanupId: cleanup.id },
      },
      ctx,
    );
  });
}

/**
 * As limpezas que ainda dá para desfazer (nos últimos 30 minutos, não desfeitas): o aviso com o
 * Desfazer no topo de Categorias, para quem pode mexer nas categorias do lar.
 */
export async function undoableCleanups(
  db: PrismaClient,
  grant: HouseholdGrant<"manage_categories">,
  now: Date = new Date(),
) {
  const rows = await db.categoryCleanup.findMany({
    where: {
      householdId: grant.household.id,
      undoneAt: null,
      createdAt: { gte: new Date(now.getTime() - CLEANUP_UNDO_MINUTES * 60_000) },
    },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      transactionCount: true,
      archived: true,
      createdAt: true,
      category: { select: { name: true } },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    categoryName: r.category.name,
    count: r.transactionCount,
    archived: r.archived,
    /** Até quando o Desfazer vale */
    until: new Date(r.createdAt.getTime() + CLEANUP_UNDO_MINUTES * 60_000),
  }));
}
