// Categorias, regras e a cascata de sugestão (M07).
//
// As categorias e as regras são do LAR (as duas pessoas organizam juntas): criar e arquivar pede
// o crachá "manage_categories" do lar. A SUGESTÃO, porém, olha o histórico só das carteiras que
// a pessoa pode ver (WalletScope): se o histórico de uma carteira pessoal entrasse na conta, a
// sugestão contaria à outra pessoa onde ela compra (vazamento por canal lateral, ADR-007).
import {
  explainCascade,
  explainClassifier,
  explainHistory,
  explainProvider,
  explainRules,
  civilFromDbDate,
  normalizeRulePattern,
  runCascade,
  AUTOMATIC_SOURCES,
  LOCAL_AI_BULK_SOURCES,
  LOCAL_AI_SOURCE,
  suggesterFrom,
  type CategorySuggester,
  type CategorySuggestion,
  type ClassifierCandidate,
  type ClassifierPort,
  type RuleMatch,
  type SuggestionInput,
} from "@fintrack/core";
import { DomainError, isUuid, type HouseholdGrant, type WalletScope } from "./access";
import { writeAudit, type RequestContext } from "./audit";
import { Prisma, type PrismaClient } from "./generated/prisma/client";
import { localAiEnabled } from "./local-ai";
import { fromDbDecimal } from "./money";

// ── Categorias ──────────────────────────────────────────────────────────────────

/**
 * As categorias do lar como árvore mínima (id e pai), arquivadas incluídas: um lançamento antigo
 * numa categoria arquivada continua dentro do grupo dela. Base de subtreeOf e categoryGroupOf.
 */
export async function categoryNodes(
  db: PrismaClient | Prisma.TransactionClient,
  householdId: string,
): Promise<{ id: string; parentId: string | null }[]> {
  return db.category.findMany({
    where: { householdId },
    select: { id: true, parentId: true },
  });
}

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
 * Editar categoria (M13.2): o nome e o tipo. O nome continua único no lar (CATEGORY_EXISTS). O tipo
 * só muda numa categoria sem pai, sem subcategorias, sem recorrência nem orçado, e com todos os
 * lançamentos do sinal do tipo novo (saída = despesa, entrada = receita): a regra do M07 não deixa
 * um lançamento usar categoria do outro tipo. Auditoria só com os nomes dos campos.
 */
export async function updateCategory(
  db: PrismaClient,
  grant: HouseholdGrant<"manage_categories">,
  categoryId: string,
  input: { name: string; kind: "EXPENSE" | "INCOME" },
  ctx: RequestContext,
) {
  const householdId = grant.household.id;
  await db.$transaction(async (tx) => {
    const current = await tx.category.findFirst({
      where: { id: categoryId, householdId },
      select: {
        name: true,
        kind: true,
        parentId: true,
        _count: { select: { children: true, recurrences: true, budgets: true } },
      },
    });
    if (!current) throw new DomainError("NOT_FOUND");
    if (input.kind !== current.kind) {
      const otherSign = await tx.transaction.count({
        where: {
          categoryId,
          householdId,
          deletedAt: null,
          amount: input.kind === "EXPENSE" ? { gt: 0 } : { lt: 0 },
        },
      });
      const { children, recurrences, budgets } = current._count;
      if (current.parentId || children > 0 || recurrences > 0 || budgets > 0 || otherSign > 0) {
        throw new DomainError("CATEGORY_KIND_LOCKED");
      }
    }
    const changed = [
      ...(input.name !== current.name ? ["name"] : []),
      ...(input.kind !== current.kind ? ["kind"] : []),
    ];
    try {
      await tx.category.update({
        where: { id: categoryId },
        data: { name: input.name, kind: input.kind },
      });
    } catch (error) {
      // @@unique([householdId, name]): nome repetido no lar
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new DomainError("CATEGORY_EXISTS");
      }
      throw error;
    }
    await writeAudit(
      tx,
      {
        actorId: grant.userId,
        householdId,
        action: "category.updated",
        entity: "category",
        entityId: categoryId,
        metadata: { changed },
      },
      ctx,
    );
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

// ── A cascata: as camadas ───────────────────────────────────────────────────────

/** Quantos lançamentos recentes o histórico olha. Para duas pessoas, ~2 anos de compras. */
export const HISTORY_WINDOW = 2000;

const signOf = (kind: SuggestionInput["kind"]) => (kind === "expense" ? { lt: 0 } : { gt: 0 });
const categoryKind = (kind: SuggestionInput["kind"]) => (kind === "expense" ? "EXPENSE" : "INCOME");

/**
 * Os lançamentos que valem como "voto" (histórico, banco) e como exemplo de treino: das
 * carteiras pedidas, não excluídos, sem transferência, com categoria ativa e do mesmo sinal.
 * Recebido do banco com a categoria que a PRÓPRIA cascata sugeriu ainda não vale: senão uma
 * sugestão errada se reforçaria sozinha a cada busca (M09.1). Escolhido pela pessoa vale.
 */
export function votingWhere(
  walletIds: readonly string[],
  kind?: SuggestionInput["kind"],
): Prisma.TransactionWhereInput {
  return {
    walletId: { in: [...walletIds] },
    deletedAt: null,
    transferId: null,
    categoryId: { not: null },
    ...(kind ? { amount: signOf(kind) } : {}),
    category: { archivedAt: null, ...(kind ? { kind: categoryKind(kind) } : {}) },
    // Um recebido ainda pendente categorizado por qualquer camada automática (a IA local também)
    // não vota: a sugestão errada viraria exemplo de si mesma
    NOT: { status: "PENDING", categorizedBy: { in: [...AUTOMATIC_SOURCES] } },
  };
}

/** As categorias que uma sugestão pode devolver: do lar, ativas e do tipo do lançamento. */
async function usableCategories(
  db: PrismaClient | Prisma.TransactionClient,
  householdId: string,
  kind: SuggestionInput["kind"],
) {
  return db.category.findMany({
    where: { householdId, archivedAt: null, kind: categoryKind(kind) },
    select: { id: true, name: true },
  });
}

/** Camada 1: as regras do lar (só as de categoria ativa e do tipo certo). */
export function ruleSuggester(db: PrismaClient, scope: WalletScope<"view">): CategorySuggester {
  return suggesterFrom("RULE", async (input) => {
    if (!scope.householdId) return { suggestion: null, detail: "Sem lar" };
    const rules = await db.categoryRule.findMany({
      where: {
        householdId: scope.householdId,
        category: { archivedAt: null, kind: categoryKind(input.kind) },
      },
      select: { id: true, categoryId: true, pattern: true, match: true, priority: true },
    });
    return explainRules(rules, input.description);
  });
}

/**
 * Camada 2: o histórico das carteiras que a pessoa VÊ (nunca o lar inteiro), só lançamentos
 * categorizados, não excluídos, que não são transferência e do mesmo sinal.
 */
export function historySuggester(db: PrismaClient, scope: WalletScope<"view">): CategorySuggester {
  return suggesterFrom("HISTORY", async (input) => {
    if (scope.walletIds.length === 0) return explainHistory([], input.description);
    const rows = await db.transaction.findMany({
      where: votingWhere(scope.walletIds, input.kind),
      orderBy: [{ occurredOn: "desc" }, { id: "desc" }],
      take: HISTORY_WINDOW,
      select: { description: true, categoryId: true },
    });
    return explainHistory(
      rows.flatMap((r) =>
        r.categoryId ? [{ description: r.description, categoryId: r.categoryId }] : [],
      ),
      input.description,
    );
  });
}

/**
 * Camada 3 (M10.1): a categoria que o banco mandou, traduzida para a do lar pelo que a pessoa
 * já escolheu para o mesmo texto do banco nas carteiras que ela VÊ, ou pelo mesmo nome.
 */
export function providerSuggester(db: PrismaClient, scope: WalletScope<"view">): CategorySuggester {
  return suggesterFrom("PROVIDER", async (input) => {
    const said = input.providerCategory?.trim();
    if (!said || !scope.householdId) return explainProvider([], said, []);
    const [rows, categories] = await Promise.all([
      scope.walletIds.length === 0
        ? []
        : db.transaction.findMany({
            where: {
              ...votingWhere(scope.walletIds, input.kind),
              // O texto é comparado no core (sem acento e sem caixa): aqui, só os que têm
              providerCategory: { not: null },
            },
            orderBy: [{ occurredOn: "desc" }, { id: "desc" }],
            take: HISTORY_WINDOW,
            select: { providerCategory: true, categoryId: true },
          }),
      usableCategories(db, scope.householdId, input.kind),
    ]);
    return explainProvider(
      rows.flatMap((r) =>
        r.categoryId && r.providerCategory
          ? [{ providerCategory: r.providerCategory, categoryId: r.categoryId }]
          : [],
      ),
      said,
      categories,
    );
  });
}

/**
 * Camada 4 (M10.1, ADR-015): o classificador do serviço Python. Pergunta SÓ aos modelos das
 * carteiras que a pessoa vê (um modelo por carteira; a de outra pessoa nunca entra). Sem
 * modelo treinado, nem chama o serviço. Serviço fora ou lento: segue sem esta camada (a
 * porta devolve null), e o lançamento nunca espera por ela além do limite da porta.
 */
export function classifierSuggester(
  db: PrismaClient,
  scope: WalletScope<"view">,
  port: ClassifierPort | null,
): CategorySuggester {
  return suggesterFrom("CLASSIFIER", async (input) => {
    if (!port)
      return { suggestion: null, detail: "O classificador não está ligado neste servidor" };
    if (!scope.householdId || scope.walletIds.length === 0) {
      return explainClassifier([], [], 0);
    }
    const models = (
      await db.classifierModel.findMany({
        where: { walletId: { in: [...scope.walletIds] } },
        select: { walletId: true },
      })
    ).map((m) => m.walletId);
    if (models.length === 0) return explainClassifier([], [], 0);
    const [candidates, categories] = await Promise.all([
      port
        .suggest({ models, description: input.description, kind: input.kind })
        .catch((): ClassifierCandidate[] | null => null),
      usableCategories(db, scope.householdId, input.kind),
    ]);
    return explainClassifier(candidates, categories, models.length);
  });
}

/** As camadas que dependem de fora do banco (o serviço Python). Ausente = camada desligada. */
export type CascadeServices = { classifier?: ClassifierPort | null };

/**
 * As camadas, em ordem: regras → histórico → banco → classificador (M10.1). O LLM do M10.2 NÃO
 * entra aqui: ele roda numa fila, depois do lançamento salvo (ADR-007). Quem chama não muda.
 */
export function defaultSuggesters(
  db: PrismaClient,
  scope: WalletScope<"view">,
  services: CascadeServices = {},
): CategorySuggester[] {
  return [
    ruleSuggester(db, scope),
    historySuggester(db, scope),
    providerSuggester(db, scope),
    classifierSuggester(db, scope, services.classifier ?? null),
  ];
}

/** A sugestão de categoria para uma descrição, pela cascata. */
export async function suggestCategory(
  db: PrismaClient,
  scope: WalletScope<"view">,
  input: SuggestionInput,
  services: CascadeServices = {},
): Promise<CategorySuggestion | null> {
  return runCascade(defaultSuggesters(db, scope, services), input);
}

/** A cascata explicada camada por camada ("Por que essa categoria?", M10.1). */
export async function explainCategory(
  db: PrismaClient,
  scope: WalletScope<"view">,
  input: SuggestionInput,
  services: CascadeServices = {},
) {
  return explainCascade(defaultSuggesters(db, scope, services), input);
}

/**
 * "Por que essa categoria?" de um lançamento (M10.1, prancha F-Sugestoes): o que está gravado
 * (categoria, quem decidiu, confiança) e a cascata de HOJE, camada por camada, vista por quem
 * pergunta. Só lançamento de carteira que a pessoa vê; fora disso, null (a tela dá 404).
 */
export async function explainTransaction(
  db: PrismaClient,
  scope: WalletScope<"view">,
  transactionId: string,
  services: CascadeServices = {},
) {
  if (!isUuid(transactionId)) return null;
  const row = await db.transaction.findFirst({
    where: { id: transactionId, walletId: { in: [...scope.walletIds] }, deletedAt: null },
    select: {
      id: true,
      walletId: true,
      description: true,
      amount: true,
      occurredOn: true,
      status: true,
      transferId: true,
      providerCategory: true,
      categorizedBy: true,
      categorizationConfidence: true,
      householdId: true,
      source: true,
      localAiAttempt: {
        select: { outcome: true, proposedName: true, proposedParent: { select: { name: true } } },
      },
      category: { select: { id: true, name: true } },
    },
  });
  if (!row || row.transferId) return null;
  const kind = row.amount.isNegative() ? ("expense" as const) : ("income" as const);
  const explained = await explainCategory(
    db,
    scope,
    { description: row.description, kind, providerCategory: row.providerCategory },
    services,
  );
  const suggested = explained.suggestion
    ? await db.category.findUnique({
        where: { id: explained.suggestion.categoryId },
        select: { id: true, name: true },
      })
    : null;
  return {
    transaction: {
      id: row.id,
      walletId: row.walletId,
      description: row.description,
      amount: fromDbDecimal(row.amount),
      occurredOn: civilFromDbDate(row.occurredOn),
      pending: row.status === "PENDING",
      category: row.category,
      categorizedBy: row.categorizedBy,
      confidence: row.categorizationConfidence,
    },
    layers: explained.layers,
    /** O que a cascata sugere hoje (pode ser diferente do gravado: uma regra nova, um treino) */
    suggested: suggested && explained.suggestion ? { ...suggested, ...explained.suggestion } : null,
    localAi: explainLocalAi({
      ...row,
      pending: row.status === "PENDING",
      cascadeDecided: explained.suggestion !== null,
      enabled: await localAiEnabled(db, row.householdId),
    }),
  };
}

export type LocalAiLayerState =
  /** A categoria gravada veio da IA local, à noite */
  | "DECIDED"
  /** A cascata de hoje resolve: a IA nem seria perguntada */
  | "SKIPPED"
  /** Lançamento feito à mão (ou recorrência): a IA nunca vê */
  | "NOT_BULK"
  /** A IA local está desligada no lar */
  | "OFF"
  /** Na fila: a IA pergunta na próxima janela da noite */
  | "QUEUED"
  /** A IA propôs uma categoria nova (proposal) */
  | "NEW_CATEGORY"
  | "NO_SUGGESTION"
  | "BLOCKED"
  | "INVALID"
  /** A IA sugeriu, mas a pessoa já escolheu outra */
  | "REPLACED"
  /** Já conferido sem categoria, ou fora da fila por outro motivo */
  | "DONE";

/** A 5ª camada do "Por que essa categoria?" (M10.2b): o que a IA local fez com este lançamento. */
export function explainLocalAi(row: {
  categorizedBy: string | null;
  categoryId?: string | null;
  category: { id: string } | null;
  source: string;
  pending: boolean;
  cascadeDecided: boolean;
  enabled: boolean;
  localAiAttempt: {
    outcome: string;
    proposedName: string | null;
    proposedParent: { name: string } | null;
  } | null;
}): { state: LocalAiLayerState; proposal: { name: string; parent: string | null } | null } {
  const none = { proposal: null };
  if (row.categorizedBy === LOCAL_AI_SOURCE) return { state: "DECIDED", ...none };
  if (!(LOCAL_AI_BULK_SOURCES as readonly string[]).includes(row.source)) {
    return { state: "NOT_BULK", ...none };
  }
  const attempt = row.localAiAttempt;
  if (attempt) {
    if (attempt.outcome === "NEW_CATEGORY" && attempt.proposedName && !row.category) {
      return {
        state: "NEW_CATEGORY",
        proposal: { name: attempt.proposedName, parent: attempt.proposedParent?.name ?? null },
      };
    }
    if (attempt.outcome === "SUGGESTED" || attempt.outcome === "NEW_CATEGORY") {
      return { state: "REPLACED", ...none };
    }
    return { state: attempt.outcome as LocalAiLayerState, ...none };
  }
  if (row.cascadeDecided) return { state: "SKIPPED", ...none };
  if (!row.enabled) return { state: "OFF", ...none };
  if (row.pending && !row.category) return { state: "QUEUED", ...none };
  return { state: "DONE", ...none };
}

export type TransactionExplanation = NonNullable<Awaited<ReturnType<typeof explainTransaction>>>;
