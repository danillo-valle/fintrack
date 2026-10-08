// Categorias, regras e a cascata de sugestão (M07).
//
// As categorias e as regras são do LAR (as duas pessoas organizam juntas): criar e arquivar pede
// o crachá "manage_categories" do lar. A SUGESTÃO, porém, olha o histórico só das carteiras que
// a pessoa pode ver (WalletScope): se o histórico de uma carteira pessoal entrasse na conta, a
// sugestão contaria à outra pessoa onde ela compra (vazamento por canal lateral, ADR-007).
import {
  normalizeRulePattern,
  runCascade,
  suggestFromHistory,
  suggestFromRules,
  type CategorySuggester,
  type CategorySuggestion,
  type RuleMatch,
  type SuggestionInput,
} from "@fintrack/core";
import { DomainError, type HouseholdGrant, type WalletScope } from "./access";
import { writeAudit, type RequestContext } from "./audit";
import { Prisma, type PrismaClient } from "./generated/prisma/client";

// ── Categorias ──────────────────────────────────────────────────────────────────

/** Categorias do lar (ativas primeiro), com o nome do pai, para os seletores e a tela. */
export async function listCategories(
  db: PrismaClient,
  grant: HouseholdGrant<"view">,
  options: { includeArchived?: boolean } = {},
) {
  const rows = await db.category.findMany({
    where: {
      householdId: grant.household.id,
      ...(options.includeArchived ? {} : { archivedAt: null }),
    },
    orderBy: [{ kind: "asc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      kind: true,
      parentId: true,
      archivedAt: true,
      parent: { select: { name: true } },
      _count: { select: { transactions: true, rules: true } },
    },
  });
  return rows.map((c) => ({
    id: c.id,
    name: c.name,
    kind: c.kind,
    parentId: c.parentId,
    parentName: c.parent?.name ?? null,
    archived: c.archivedAt !== null,
    transactionCount: c._count.transactions,
    ruleCount: c._count.rules,
  }));
}

export async function createCategory(
  db: PrismaClient,
  grant: HouseholdGrant<"manage_categories">,
  input: { name: string; kind: "EXPENSE" | "INCOME"; parentId?: string | null },
  ctx: RequestContext,
) {
  const householdId = grant.household.id;
  return db.$transaction(async (tx) => {
    if (input.parentId) {
      const parent = await tx.category.findFirst({
        where: { id: input.parentId, householdId, archivedAt: null, kind: input.kind },
        select: { id: true },
      });
      if (!parent) throw new DomainError("CATEGORY_INVALID");
    }
    try {
      const category = await tx.category.create({
        data: { householdId, name: input.name, kind: input.kind, parentId: input.parentId ?? null },
      });
      await writeAudit(
        tx,
        {
          actorId: grant.userId,
          householdId,
          action: "category.created",
          entity: "category",
          entityId: category.id,
          metadata: { kind: input.kind },
        },
        ctx,
      );
      return category;
    } catch (error) {
      // @@unique([householdId, name]): nome repetido no lar
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new DomainError("CATEGORY_EXISTS");
      }
      throw error;
    }
  });
}

/**
 * Arquiva (ou restaura) uma categoria. Arquivada, ela some dos seletores e da sugestão; os
 * lançamentos antigos continuam com ela. Com subcategorias ativas, não arquiva.
 */
export async function setCategoryArchived(
  db: PrismaClient,
  grant: HouseholdGrant<"manage_categories">,
  categoryId: string,
  archived: boolean,
  ctx: RequestContext,
) {
  const householdId = grant.household.id;
  await db.$transaction(async (tx) => {
    if (archived) {
      const children = await tx.category.count({
        where: { parentId: categoryId, householdId, archivedAt: null },
      });
      if (children > 0) throw new DomainError("CATEGORY_IN_USE_AS_PARENT");
    }
    const { count } = await tx.category.updateMany({
      where: { id: categoryId, householdId },
      data: { archivedAt: archived ? new Date() : null },
    });
    if (count === 0) throw new DomainError("NOT_FOUND");
    await writeAudit(
      tx,
      {
        actorId: grant.userId,
        householdId,
        action: "category.archived",
        entity: "category",
        entityId: categoryId,
        metadata: { archived },
      },
      ctx,
    );
  });
}

/**
 * Confere se a categoria pode ir num lançamento: do mesmo lar, ativa e do tipo certo (despesa
 * numa saída, receita numa entrada). Devolve null para "sem categoria".
 */
export async function assertUsableCategory(
  tx: Prisma.TransactionClient,
  householdId: string,
  categoryId: string | null,
  kind: "expense" | "income",
): Promise<string | null> {
  if (!categoryId) return null;
  const found = await tx.category.count({
    where: {
      id: categoryId,
      householdId,
      archivedAt: null,
      kind: kind === "expense" ? "EXPENSE" : "INCOME",
    },
  });
  if (found === 0) throw new DomainError("CATEGORY_INVALID");
  return categoryId;
}

// ── Regras ──────────────────────────────────────────────────────────────────────

export async function listRules(db: PrismaClient, grant: HouseholdGrant<"view">) {
  return db.categoryRule.findMany({
    where: { householdId: grant.household.id },
    orderBy: [{ priority: "asc" }, { pattern: "asc" }],
    select: {
      id: true,
      pattern: true,
      match: true,
      priority: true,
      category: { select: { id: true, name: true, archivedAt: true } },
    },
  });
}

/**
 * Cria uma regra texto → categoria. Recebe o cliente da transação quando nasce de uma
 * correção (a regra e a correção gravam juntas). O padrão é normalizado como o banco exige.
 */
export async function createRuleTx(
  tx: Prisma.TransactionClient,
  grant: HouseholdGrant<"manage_categories">,
  input: { categoryId: string; pattern: string; match: RuleMatch; priority?: number },
  ctx: RequestContext,
  origin: "manual" | "correction" = "manual",
) {
  const householdId = grant.household.id;
  const pattern = normalizeRulePattern(input.pattern);
  if (!pattern) throw new DomainError("RULE_PATTERN_INVALID");
  const category = await tx.category.count({
    where: { id: input.categoryId, householdId, archivedAt: null },
  });
  if (category === 0) throw new DomainError("CATEGORY_INVALID");

  const rule = await tx.categoryRule.create({
    data: {
      householdId,
      categoryId: input.categoryId,
      pattern,
      match: input.match,
      priority: input.priority ?? 100,
    },
  });
  await writeAudit(
    tx,
    {
      actorId: grant.userId,
      householdId,
      action: "category_rule.created",
      entity: "category_rule",
      entityId: rule.id,
      metadata: { match: input.match, origin },
    },
    ctx,
  );
  return rule;
}

export async function createRule(
  db: PrismaClient,
  grant: HouseholdGrant<"manage_categories">,
  input: { categoryId: string; pattern: string; match: RuleMatch; priority?: number },
  ctx: RequestContext,
) {
  return db.$transaction((tx) => createRuleTx(tx, grant, input, ctx));
}

export async function deleteRule(
  db: PrismaClient,
  grant: HouseholdGrant<"manage_categories">,
  ruleId: string,
  ctx: RequestContext,
) {
  await db.$transaction(async (tx) => {
    const { count } = await tx.categoryRule.deleteMany({
      where: { id: ruleId, householdId: grant.household.id },
    });
    if (count === 0) throw new DomainError("NOT_FOUND");
    await writeAudit(
      tx,
      {
        actorId: grant.userId,
        householdId: grant.household.id,
        action: "category_rule.deleted",
        entity: "category_rule",
        entityId: ruleId,
      },
      ctx,
    );
  });
}

// ── A cascata: as camadas do M07 ────────────────────────────────────────────────

/** Quantos lançamentos recentes o histórico olha. Para duas pessoas, ~2 anos de compras. */
export const HISTORY_WINDOW = 2000;

/** Camada 1: as regras do lar (só as de categoria ativa e do tipo certo). */
export function ruleSuggester(db: PrismaClient, scope: WalletScope<"view">): CategorySuggester {
  return {
    source: "RULE",
    async suggest(input: SuggestionInput) {
      if (!scope.householdId) return null;
      const rules = await db.categoryRule.findMany({
        where: {
          householdId: scope.householdId,
          category: { archivedAt: null, kind: input.kind === "expense" ? "EXPENSE" : "INCOME" },
        },
        select: { id: true, categoryId: true, pattern: true, match: true, priority: true },
      });
      return suggestFromRules(rules, input.description);
    },
  };
}

/**
 * Camada 2: o histórico das carteiras que a pessoa VÊ (nunca o lar inteiro), só lançamentos
 * categorizados, não excluídos, que não são transferência e do mesmo sinal.
 */
export function historySuggester(db: PrismaClient, scope: WalletScope<"view">): CategorySuggester {
  return {
    source: "HISTORY",
    async suggest(input: SuggestionInput) {
      if (scope.walletIds.length === 0) return null;
      const rows = await db.transaction.findMany({
        where: {
          walletId: { in: [...scope.walletIds] },
          deletedAt: null,
          transferId: null,
          categoryId: { not: null },
          amount: input.kind === "expense" ? { lt: 0 } : { gt: 0 },
          category: { archivedAt: null },
        },
        orderBy: [{ occurredOn: "desc" }, { id: "desc" }],
        take: HISTORY_WINDOW,
        select: { description: true, categoryId: true },
      });
      return suggestFromHistory(
        rows.flatMap((r) =>
          r.categoryId ? [{ description: r.description, categoryId: r.categoryId }] : [],
        ),
        input.description,
      );
    },
  };
}

/**
 * As camadas, em ordem. É AQUI que o M09 (Pluggy) e o M10 (classificador) entram: mais um
 * item nesta lista, implementando CategorySuggester. Quem chama não muda.
 */
export function defaultSuggesters(db: PrismaClient, scope: WalletScope<"view">) {
  return [ruleSuggester(db, scope), historySuggester(db, scope)];
}

/** A sugestão de categoria para uma descrição, pela cascata. */
export async function suggestCategory(
  db: PrismaClient,
  scope: WalletScope<"view">,
  input: SuggestionInput,
): Promise<CategorySuggestion | null> {
  return runCascade(defaultSuggesters(db, scope), input);
}
