// A IA local no banco (M10.2b, ADR-016): a fila, a noite, o interruptor, a medida e o "Criar e
// aplicar" de uma categoria nova proposta.
//
// A FILA não é uma tabela: é uma consulta (localAiQueueWhere). Entra o recebido que veio de uma
// carga do banco (Meu Pluggy, OFX, fatura PDF), ainda PENDING, sem categoria, sem par, que não é
// transferência e que a IA ainda não viu (sem linha em local_ai_attempt), num lar com a IA
// ligada. O lançamento feito à mão nunca entra (decisão de 17/10).
//
// O que vai para a IA: a descrição, o tipo e os NOMES das categorias do lar daquele tipo. Nada
// mais da pessoa. A resposta só grava categoria num recebido ainda pendente e sem categoria
// (UPDATE condicional): o que a pessoa já decidiu nunca é sobrescrito. Nada vale sem confirmar.
import {
  categoryNameKey,
  civilFromDbDate,
  isProposalName,
  LOCAL_AI_BULK_SOURCES,
  LOCAL_AI_NIGHT_LIMIT,
  LOCAL_AI_SOURCE,
  localAiNightStart,
  LocalAiUnavailable,
  type LocalAiAnswer,
  type LocalAiOutcome,
  type LocalAiPort,
} from "@fintrack/core";
import { DomainError, isUuid, type HouseholdGrant, type WalletScope } from "./access";
import { writeAudit, type RequestContext } from "./audit";
import { fromDbDecimal } from "./money";
import { Prisma, type PrismaClient } from "./generated/prisma/client";

type Db = PrismaClient | Prisma.TransactionClient;
type Kind = "expense" | "income";

/** Os recebidos que a IA ainda pode ver (a "fila"), num lar. */
export function localAiQueueWhere(householdId: string): Prisma.TransactionWhereInput {
  return {
    householdId,
    status: "PENDING",
    deletedAt: null,
    mergedIntoId: null,
    transferId: null,
    categoryId: null,
    source: { in: [...LOCAL_AI_BULK_SOURCES] },
    localAiAttempt: { is: null },
  };
}

const kindOf = (amount: Prisma.Decimal): Kind => (amount.isNegative() ? "expense" : "income");
const dbKind = (kind: Kind) => (kind === "expense" ? "EXPENSE" : "INCOME");

type KindLists = {
  categories: string[];
  parents: string[];
  idByName: Map<string, string>;
  parentIdByName: Map<string, string>;
};

/** As categorias ativas do lar por tipo: os nomes que a IA recebe e o caminho de volta ao id. */
export async function localAiCategoryLists(
  db: Db,
  householdId: string,
): Promise<Record<Kind, KindLists>> {
  const rows = await db.category.findMany({
    where: { householdId, archivedAt: null },
    orderBy: [{ name: "asc" }],
    select: { id: true, name: true, kind: true, parentId: true },
  });
  const lists = (kind: Kind): KindLists => {
    const ofKind = rows.filter((r) => r.kind === dbKind(kind));
    const parents = ofKind.filter((r) => r.parentId === null);
    return {
      categories: ofKind.map((r) => r.name),
      parents: parents.map((r) => r.name),
      idByName: new Map(ofKind.map((r) => [r.name, r.id])),
      parentIdByName: new Map(parents.map((r) => [r.name, r.id])),
    };
  };
  return { expense: lists("expense"), income: lists("income") };
}

type Resolved =
  | { outcome: "SUGGESTED"; categoryId: string }
  | { outcome: "NEW_CATEGORY"; name: string; parentId: string | null }
  | { outcome: Exclude<LocalAiOutcome, "SUGGESTED" | "NEW_CATEGORY"> };

/**
 * A resposta da IA em ids do banco. Uma categoria que sumiu da lista (arquivada no meio da noite)
 * vira "nenhuma"; uma proposta com o nome de uma categoria que já existe vira ela (mesmo tipo e
 * ativa) ou "nenhuma" (outro tipo ou arquivada: o nome está ocupado no lar).
 */
async function resolve(
  db: Db,
  householdId: string,
  lists: KindLists,
  answer: LocalAiAnswer,
): Promise<Resolved> {
  if (answer.outcome === "SUGGESTED") {
    const categoryId = lists.idByName.get(answer.category);
    return categoryId ? { outcome: "SUGGESTED", categoryId } : { outcome: "NO_SUGGESTION" };
  }
  if (answer.outcome !== "NEW_CATEGORY") return { outcome: answer.outcome };
  if (!isProposalName(answer.name)) return { outcome: "INVALID" };
  const key = categoryNameKey(answer.name);
  for (const [name, id] of lists.idByName) {
    if (categoryNameKey(name) === key) return { outcome: "SUGGESTED", categoryId: id };
  }
  const taken = await db.category.findMany({ where: { householdId }, select: { name: true } });
  if (taken.some((c) => categoryNameKey(c.name) === key)) return { outcome: "NO_SUGGESTION" };
  const parentId = answer.parent ? (lists.parentIdByName.get(answer.parent) ?? null) : null;
  return { outcome: "NEW_CATEGORY", name: answer.name, parentId };
}

export type LocalAiNight = {
  status: "DONE" | "UNAVAILABLE" | "DEADLINE";
  households: number;
  asked: number;
  applied: number;
  outcomes: Record<LocalAiOutcome, number>;
};

const emptyOutcomes = (): Record<LocalAiOutcome, number> => ({
  SUGGESTED: 0,
  NEW_CATEGORY: 0,
  NO_SUGGESTION: 0,
  BLOCKED: 0,
  INVALID: 0,
});

/**
 * Uma rodada da noite: cada lar com a IA ligada, até 200 recebidos por noite, um por vez,
 * despesas e depois receitas (o llama-server reaproveita a leitura do começo do prompt). Para
 * quando a IA sai do ar (fim da janela) ou quando passa do `deadline`. Só contagens no retorno.
 */
export async function runLocalAiNight(
  db: PrismaClient,
  port: LocalAiPort,
  options: { now?: () => Date; deadline?: Date } = {},
): Promise<LocalAiNight> {
  const now = options.now ?? (() => new Date());
  const result: LocalAiNight = {
    status: "DONE",
    households: 0,
    asked: 0,
    applied: 0,
    outcomes: emptyOutcomes(),
  };
  if (!(await port.ready())) return { ...result, status: "UNAVAILABLE" };
  const households = await db.household.findMany({
    where: { localAiEnabledAt: { not: null } },
    orderBy: { localAiEnabledAt: "asc" },
    select: { id: true },
  });
  for (const { id: householdId } of households) {
    result.households += 1;
    const already = await db.localAiAttempt.count({
      where: { householdId, attemptedAt: { gte: localAiNightStart(now()) } },
    });
    const room = LOCAL_AI_NIGHT_LIMIT - already;
    if (room <= 0) continue;
    const rows = await db.transaction.findMany({
      where: localAiQueueWhere(householdId),
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: room,
      select: { id: true, description: true, amount: true },
    });
    // Despesas primeiro, depois receitas (estável: dentro de cada tipo, a ordem de chegada)
    const queue = [...rows].sort(
      (a, b) => (a.amount.isNegative() ? 0 : 1) - (b.amount.isNegative() ? 0 : 1),
    );
    const lists = await localAiCategoryLists(db, householdId);
    for (const row of queue) {
      if (options.deadline && now() >= options.deadline) return { ...result, status: "DEADLINE" };
      const kind = kindOf(row.amount);
      // Sem categoria nenhuma daquele tipo no lar: fica na fila (nada a escolher)
      if (lists[kind].categories.length === 0) continue;
      let answer: LocalAiAnswer;
      try {
        answer = await port.suggest({
          description: row.description,
          kind,
          categories: lists[kind].categories,
          parents: lists[kind].parents,
        });
      } catch (error) {
        if (error instanceof LocalAiUnavailable) return { ...result, status: "UNAVAILABLE" };
        throw error;
      }
      result.asked += 1;
      const resolved = await resolve(db, householdId, lists[kind], answer);
      result.outcomes[resolved.outcome] += 1;
      result.applied += await record(db, householdId, row.id, resolved, now());
    }
  }
  return result;
}

/** Grava o que a IA respondeu; com SUGGESTED, a categoria vai para o recebido (se ainda cabe). */
async function record(
  db: PrismaClient,
  householdId: string,
  transactionId: string,
  resolved: Resolved,
  at: Date,
): Promise<number> {
  return db.$transaction(async (tx) => {
    try {
      await tx.localAiAttempt.create({
        data: {
          transactionId,
          householdId,
          outcome: resolved.outcome,
          proposedName: resolved.outcome === "NEW_CATEGORY" ? resolved.name : null,
          proposedParentId: resolved.outcome === "NEW_CATEGORY" ? resolved.parentId : null,
          attemptedAt: at,
        },
      });
    } catch (error) {
      // Já visto (duas rodadas ao mesmo tempo não deveriam existir: a fila é "stately")
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return 0;
      throw error;
    }
    if (resolved.outcome !== "SUGGESTED") return 0;
    const { count } = await tx.transaction.updateMany({
      where: { id: transactionId, categoryId: null, status: "PENDING", deletedAt: null },
      data: {
        categoryId: resolved.categoryId,
        categorizedBy: LOCAL_AI_SOURCE,
        categorizationConfidence: null,
      },
    });
    return count;
  });
}

// ── O interruptor ────────────────────────────────────────────────────────────────

/** Liga ou desliga a IA local do lar (só quem mexe nas categorias do lar). Auditado. */
export async function setLocalAi(
  db: PrismaClient,
  grant: HouseholdGrant<"manage_categories">,
  enabled: boolean,
  ctx: RequestContext,
  now: Date = new Date(),
) {
  const householdId = grant.household.id;
  return db.$transaction(async (tx) => {
    const current = await tx.household.findUniqueOrThrow({
      where: { id: householdId },
      select: { localAiEnabledAt: true },
    });
    if ((current.localAiEnabledAt !== null) === enabled) return current.localAiEnabledAt;
    const localAiEnabledAt = enabled ? now : null;
    await tx.household.update({ where: { id: householdId }, data: { localAiEnabledAt } });
    await writeAudit(
      tx,
      {
        actorId: grant.userId,
        householdId,
        action: enabled ? "local_ai.enabled" : "local_ai.disabled",
        entity: "household",
        entityId: householdId,
        metadata: {},
      },
      ctx,
    );
    return localAiEnabledAt;
  });
}

// ── O que a tela mostra ──────────────────────────────────────────────────────────

/**
 * O cartão "IA local" de Ajustes › Categorização: ligada desde quando, quantos estão na fila e o
 * que a última noite fez, tudo pelas carteiras que a pessoa VÊ (contagens, nunca descrições).
 */
export async function localAiSummary(db: PrismaClient, scope: WalletScope<"view">) {
  if (!scope.householdId) return null;
  const household = await db.household.findUnique({
    where: { id: scope.householdId },
    select: { localAiEnabledAt: true },
  });
  const inScope = { transaction: { walletId: { in: [...scope.walletIds] } } };
  const [queued, last] = await Promise.all([
    household?.localAiEnabledAt
      ? db.transaction.count({
          where: {
            ...localAiQueueWhere(scope.householdId),
            walletId: { in: [...scope.walletIds] },
          },
        })
      : Promise.resolve(0),
    db.localAiAttempt.findFirst({
      where: { householdId: scope.householdId, ...inScope },
      orderBy: { attemptedAt: "desc" },
      select: { attemptedAt: true },
    }),
  ]);
  let lastNight: { at: Date; outcomes: Record<LocalAiOutcome, number> } | null = null;
  if (last) {
    const grouped = await db.localAiAttempt.groupBy({
      by: ["outcome"],
      where: {
        householdId: scope.householdId,
        ...inScope,
        attemptedAt: { gte: localAiNightStart(last.attemptedAt) },
      },
      _count: { _all: true },
    });
    const outcomes = emptyOutcomes();
    for (const row of grouped) outcomes[row.outcome] = row._count._all;
    lastNight = { at: last.attemptedAt, outcomes };
  }
  return { enabledAt: household?.localAiEnabledAt ?? null, queued, lastNight };
}

export type LocalAiSummary = NonNullable<Awaited<ReturnType<typeof localAiSummary>>>;

/** A IA está ligada no lar da pessoa? (para a aba "Na fila da IA" e o "Por que") */
export async function localAiEnabled(db: Db, householdId: string | null): Promise<boolean> {
  if (!householdId) return false;
  const household = await db.household.findUnique({
    where: { id: householdId },
    select: { localAiEnabledAt: true },
  });
  return Boolean(household?.localAiEnabledAt);
}

// ── Criar e aplicar a categoria nova ─────────────────────────────────────────────

/** Os pendentes com a mesma proposta (mesmo nome, mesmo tipo) nas carteiras dadas. */
async function sameProposal(db: Db, walletIds: readonly string[], kind: Kind, proposed: string) {
  const rows = await db.transaction.findMany({
    where: {
      walletId: { in: [...walletIds] },
      status: "PENDING",
      deletedAt: null,
      categoryId: null,
      amount: kind === "expense" ? { lt: 0 } : { gt: 0 },
      localAiAttempt: { outcome: "NEW_CATEGORY" },
    },
    orderBy: [{ occurredOn: "desc" }, { id: "asc" }],
    select: {
      id: true,
      description: true,
      occurredOn: true,
      localAiAttempt: { select: { proposedName: true } },
    },
  });
  const key = categoryNameKey(proposed);
  return rows.filter((t) => categoryNameKey(t.localAiAttempt?.proposedName ?? "") === key);
}

/**
 * O que o "Criar e aplicar" mostra antes (pranchas F2-Recebidos e F2-CelCriar): a proposta, as
 * mães possíveis (as de 1º nível do tipo) e os recebidos onde ela vai entrar, nas carteiras que
 * a pessoa edita. null = não há proposta (já resolvido, ou carteira que ela não edita).
 */
export async function localAiProposalPreview(
  db: PrismaClient,
  scope: WalletScope<"edit">,
  transactionId: string,
) {
  if (!isUuid(transactionId) || !scope.householdId) return null;
  const source = await db.transaction.findFirst({
    where: {
      id: transactionId,
      walletId: { in: [...scope.walletIds] },
      status: "PENDING",
      deletedAt: null,
      categoryId: null,
      localAiAttempt: { outcome: "NEW_CATEGORY" },
    },
    select: {
      id: true,
      description: true,
      amount: true,
      occurredOn: true,
      localAiAttempt: {
        select: { proposedName: true, proposedParent: { select: { id: true, name: true } } },
      },
    },
  });
  const proposed = source?.localAiAttempt?.proposedName;
  if (!source || !proposed) return null;
  const kind = kindOf(source.amount);
  const [parents, siblings] = await Promise.all([
    db.category.findMany({
      where: {
        householdId: scope.householdId,
        archivedAt: null,
        kind: dbKind(kind),
        parentId: null,
      },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    sameProposal(db, scope.walletIds, kind, proposed),
  ]);
  return {
    transaction: {
      id: source.id,
      description: source.description,
      amount: fromDbDecimal(source.amount),
      occurredOn: civilFromDbDate(source.occurredOn),
    },
    kind,
    name: proposed,
    parent: source.localAiAttempt?.proposedParent ?? null,
    parents,
    siblings: siblings.map((t) => ({
      id: t.id,
      description: t.description,
      occurredOn: civilFromDbDate(t.occurredOn),
    })),
  };
}

export type LocalAiProposalPreview = NonNullable<
  Awaited<ReturnType<typeof localAiProposalPreview>>
>;

/**
 * "Criar e aplicar" (adendo do ADR-016): cria a categoria que a IA propôs (a pessoa pode ter
 * trocado o nome e a mãe) e aplica a ela este recebido e os outros pendentes com a MESMA
 * proposta, nas carteiras que a pessoa edita. Se já existir uma categoria ativa do mesmo tipo com
 * esse nome, só aplica. Autor: LLM se o nome é o proposto; MANUAL se a pessoa trocou.
 */
export async function applyLocalAiProposal(
  db: PrismaClient,
  grant: HouseholdGrant<"manage_categories">,
  scope: WalletScope<"edit">,
  input: { transactionId: string; name: string; parentId: string | null },
  ctx: RequestContext,
) {
  const householdId = grant.household.id;
  if (!isUuid(input.transactionId) || scope.householdId !== householdId) {
    throw new DomainError("NOT_FOUND");
  }
  const name = input.name.trim().replace(/\s+/g, " ");
  if (name.length < 1 || name.length > 60) throw new DomainError("CATEGORY_INVALID");
  return db.$transaction(async (tx) => {
    const source = await tx.transaction.findFirst({
      where: {
        id: input.transactionId,
        walletId: { in: [...scope.walletIds] },
        status: "PENDING",
        deletedAt: null,
        categoryId: null,
        localAiAttempt: { outcome: "NEW_CATEGORY" },
      },
      select: { amount: true, localAiAttempt: { select: { proposedName: true } } },
    });
    const proposed = source?.localAiAttempt?.proposedName;
    if (!source || !proposed) throw new DomainError("REVIEW_STALE");
    const kind = kindOf(source.amount);
    if (input.parentId) {
      if (!isUuid(input.parentId)) throw new DomainError("CATEGORY_INVALID");
      const parent = await tx.category.findFirst({
        where: {
          id: input.parentId,
          householdId,
          archivedAt: null,
          kind: dbKind(kind),
          parentId: null,
        },
        select: { id: true },
      });
      if (!parent) throw new DomainError("CATEGORY_INVALID");
    }
    const all = await tx.category.findMany({
      where: { householdId },
      select: { id: true, name: true, kind: true, archivedAt: true },
    });
    const same = all.find((c) => categoryNameKey(c.name) === categoryNameKey(name));
    let categoryId: string;
    let created = false;
    if (same) {
      // O nome já existe no lar: serve se for do mesmo tipo e ativa; senão, está ocupado
      if (same.kind !== dbKind(kind) || same.archivedAt) throw new DomainError("CATEGORY_EXISTS");
      categoryId = same.id;
    } else {
      const category = await tx.category
        .create({
          data: { householdId, name, kind: dbKind(kind), parentId: input.parentId ?? null },
          select: { id: true },
        })
        .catch((error: unknown) => {
          // @@unique([householdId, name]): alguém criou o mesmo nome agora há pouco
          if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
            throw new DomainError("CATEGORY_EXISTS");
          }
          throw error;
        });
      categoryId = category.id;
      created = true;
      await writeAudit(
        tx,
        {
          actorId: grant.userId,
          householdId,
          action: "category.created",
          entity: "category",
          entityId: categoryId,
          metadata: { kind: dbKind(kind), from: "local_ai" },
        },
        ctx,
      );
    }
    const ids = (await sameProposal(tx, scope.walletIds, kind, proposed)).map((t) => t.id);
    const author = categoryNameKey(name) === categoryNameKey(proposed) ? LOCAL_AI_SOURCE : "MANUAL";
    const { count } = await tx.transaction.updateMany({
      where: { id: { in: ids }, categoryId: null, status: "PENDING", deletedAt: null },
      data: { categoryId, categorizedBy: author, categorizationConfidence: null },
    });
    await writeAudit(
      tx,
      {
        actorId: grant.userId,
        householdId,
        action: "local_ai.proposal_applied",
        entity: "category",
        entityId: categoryId,
        metadata: { created, count },
      },
      ctx,
    );
    return { categoryId, created, applied: count };
  });
}
