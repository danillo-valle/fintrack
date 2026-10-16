// O classificador de categorias no banco (M10.1, ADR-015): o que treinar, quando e o que mostrar.
//
// O modelo em si mora no serviço Python (volume do servidor). Aqui ficam:
//   - os EXEMPLOS de treino de cada carteira (os lançamentos que a pessoa categorizou ou
//     confirmou, nunca o que a própria cascata sugeriu e ninguém conferiu);
//   - o registro do modelo (classifier_model: quando, quantos exemplos, a impressão digital);
//   - o preenchimento dos recebidos ainda sem categoria depois de um treino;
//   - a medida "quem categorizou" que a tela de Ajustes › Categorização mostra.
//
// Um modelo por CARTEIRA: o modelo da carteira X só aprende com X e só responde a quem vê X
// (classifierSuggester). Treinar o lar inteiro num modelo só vazaria, pela sugestão, onde a
// outra pessoa compra (o mesmo canal lateral do histórico, ADR-007).
import { createHash } from "node:crypto";
import {
  addDays,
  categorizationBreakdown,
  dbDateFromCivil,
  explainClassifier,
  todayCivil,
  type BreakdownKey,
  type CivilDate,
  type ClassifierPort,
  type TrainingExample,
} from "@fintrack/core";
import type { HouseholdGrant, WalletScope } from "./access";
import { writeAudit, type RequestContext } from "./audit";
import { votingWhere } from "./categories";
import type { Prisma, PrismaClient } from "./generated/prisma/client";

/** Os mesmos limites do serviço (services/ml/app/classificador.py). */
export const CLASSIFIER_MIN_EXAMPLES = 20;
export const CLASSIFIER_MAX_EXAMPLES = 10_000;
/** Quantos recebidos sem categoria um treino tenta preencher de uma vez. */
export const FILL_BATCH = 500;
/** A janela da medida da tela: os lançamentos dos últimos 30 dias. */
export const STATS_DAYS = 30;

/** Os exemplos de treino de uma carteira, do mais recente para o mais antigo. */
export async function trainingExamples(
  db: PrismaClient,
  walletId: string,
): Promise<TrainingExample[]> {
  const rows = await db.transaction.findMany({
    where: votingWhere([walletId]),
    orderBy: [{ occurredOn: "desc" }, { id: "desc" }],
    take: CLASSIFIER_MAX_EXAMPLES,
    select: { description: true, amount: true, categoryId: true },
  });
  return rows.flatMap((r) =>
    r.categoryId
      ? [
          {
            description: r.description,
            kind: r.amount.isNegative() ? ("expense" as const) : ("income" as const),
            categoryId: r.categoryId,
          },
        ]
      : [],
  );
}

/** A impressão digital dos exemplos (SHA-256): igual à do último treino = nada mudou. */
export function trainingHash(examples: readonly TrainingExample[]): string {
  const hash = createHash("sha256");
  for (const e of examples) hash.update(`${e.kind}\u0000${e.categoryId}\u0000${e.description}\n`);
  return hash.digest("hex");
}

export type TrainOutcome =
  | { walletId: string; status: "TRAINED"; examples: number; categories: number; filled: number }
  | { walletId: string; status: "UNCHANGED" | "TOO_FEW"; examples: number }
  | { walletId: string; status: "FAILED"; examples: number };

async function forget(db: PrismaClient, port: ClassifierPort, walletId: string) {
  const had = await db.classifierModel.deleteMany({ where: { walletId } });
  if (had.count > 0) await port.remove(walletId);
}

/**
 * Treina o modelo de UMA carteira, se os exemplos mudaram desde o último treino. Com menos de
 * 20 exemplos (ou uma categoria só), o modelo antigo sai: melhor nenhuma sugestão que uma velha.
 * Depois de treinar, tenta preencher os recebidos da carteira que ainda estão sem categoria.
 */
export async function trainWallet(
  db: PrismaClient,
  port: ClassifierPort,
  walletId: string,
  now: Date = new Date(),
): Promise<TrainOutcome> {
  const wallet = await db.wallet.findUnique({
    where: { id: walletId },
    select: { householdId: true, archivedAt: true },
  });
  if (!wallet || wallet.archivedAt) {
    await forget(db, port, walletId);
    return { walletId, status: "TOO_FEW", examples: 0 };
  }
  const examples = await trainingExamples(db, walletId);
  const categories = new Set(examples.map((e) => e.categoryId)).size;
  if (examples.length < CLASSIFIER_MIN_EXAMPLES || categories < 2) {
    await forget(db, port, walletId);
    return { walletId, status: "TOO_FEW", examples: examples.length };
  }
  const hash = trainingHash(examples);
  const current = await db.classifierModel.findUnique({
    where: { walletId },
    select: { trainingHash: true },
  });
  if (current?.trainingHash === hash) {
    return { walletId, status: "UNCHANGED", examples: examples.length };
  }
  const trained = await port.train({ model: walletId, examples });
  if (trained === "TOO_FEW") {
    await forget(db, port, walletId);
    return { walletId, status: "TOO_FEW", examples: examples.length };
  }
  const data = {
    trainedAt: now,
    exampleCount: trained.examples,
    categoryCount: trained.categories,
    trainingHash: hash,
  };
  await db.classifierModel.upsert({
    where: { walletId },
    create: { householdId: wallet.householdId, walletId, ...data },
    update: data,
  });
  const filled = await fillUncategorized(db, port, walletId);
  return {
    walletId,
    status: "TRAINED",
    examples: trained.examples,
    categories: trained.categories,
    filled,
  };
}

/**
 * Os recebidos da carteira (PENDING) ainda sem categoria ganham a sugestão do classificador
 * DA PRÓPRIA carteira, se passar do limiar. Continuam esperando revisão: a pessoa confirma ou
 * troca (e a troca vira exemplo). O UPDATE confere de novo "ainda sem categoria e PENDING":
 * quem categorizou à mão no meio do caminho ganha.
 */
export async function fillUncategorized(
  db: PrismaClient,
  port: ClassifierPort,
  walletId: string,
): Promise<number> {
  const rows = await db.transaction.findMany({
    where: {
      walletId,
      status: "PENDING",
      categoryId: null,
      deletedAt: null,
      transferId: null,
    },
    orderBy: [{ occurredOn: "desc" }, { id: "desc" }],
    take: FILL_BATCH,
    select: { id: true, description: true, amount: true, householdId: true },
  });
  if (rows.length === 0) return 0;
  const categories = {
    expense: await db.category.findMany({
      where: { householdId: rows[0]?.householdId, archivedAt: null, kind: "EXPENSE" },
      select: { id: true, name: true },
    }),
    income: await db.category.findMany({
      where: { householdId: rows[0]?.householdId, archivedAt: null, kind: "INCOME" },
      select: { id: true, name: true },
    }),
  };
  let filled = 0;
  for (const row of rows) {
    const kind = row.amount.isNegative() ? "expense" : "income";
    const candidates = await port
      .suggest({ models: [walletId], description: row.description, kind })
      .catch(() => null);
    const { suggestion } = explainClassifier(candidates, categories[kind], 1);
    if (!suggestion) continue;
    const { count } = await db.transaction.updateMany({
      where: { id: row.id, status: "PENDING", categoryId: null, deletedAt: null },
      data: {
        categoryId: suggestion.categoryId,
        categorizedBy: "CLASSIFIER",
        categorizationConfidence: suggestion.confidence,
      },
    });
    filled += count;
  }
  return filled;
}

/** As carteiras que o treino da madrugada visita: as ativas e as arquivadas que têm modelo. */
export async function walletsForTraining(db: PrismaClient, householdId?: string) {
  const wallets = await db.wallet.findMany({
    where: {
      ...(householdId ? { householdId } : {}),
      OR: [{ archivedAt: null }, { classifierModels: { some: {} } }],
    },
    orderBy: { id: "asc" },
    select: { id: true },
  });
  return wallets.map((w) => w.id);
}

/** Treina uma lista de carteiras, uma por vez (o servidor é pequeno). Falha numa não para as outras. */
export async function trainWallets(
  db: PrismaClient,
  port: ClassifierPort,
  walletIds: readonly string[],
  now: Date = new Date(),
): Promise<TrainOutcome[]> {
  const outcomes: TrainOutcome[] = [];
  for (const walletId of walletIds) {
    try {
      outcomes.push(await trainWallet(db, port, walletId, now));
    } catch {
      outcomes.push({ walletId, status: "FAILED", examples: 0 });
    }
  }
  return outcomes;
}

/**
 * "Treinar agora" (Ajustes › Categorização): treina as carteiras que a pessoa VÊ, com o
 * crachá de quem organiza as categorias do lar, e registra na auditoria (só contagens).
 */
export async function trainNow(
  db: PrismaClient,
  port: ClassifierPort,
  grant: HouseholdGrant<"manage_categories">,
  scope: WalletScope<"view">,
  ctx: RequestContext,
  now: Date = new Date(),
): Promise<TrainOutcome[]> {
  const walletIds = scope.householdId === grant.household.id ? scope.walletIds : [];
  const outcomes = await trainWallets(db, port, walletIds, now);
  await db.$transaction((tx) =>
    writeAudit(
      tx,
      {
        actorId: grant.userId,
        householdId: grant.household.id,
        action: "classifier.trained",
        entity: "household",
        entityId: grant.household.id,
        metadata: {
          wallets: outcomes.length,
          trained: outcomes.filter((o) => o.status === "TRAINED").length,
          failed: outcomes.filter((o) => o.status === "FAILED").length,
        },
      },
      ctx,
    ),
  );
  return outcomes;
}

// ── O que a tela mostra ─────────────────────────────────────────────────────────

/** O resumo dos modelos das carteiras que a pessoa vê: o treino mais recente e os exemplos. */
export async function classifierSummary(db: PrismaClient, scope: WalletScope<"view">) {
  const models = await db.classifierModel.findMany({
    where: { walletId: { in: [...scope.walletIds] } },
    select: { trainedAt: true, exampleCount: true },
  });
  return {
    models: models.length,
    examples: models.reduce((sum, m) => sum + m.exampleCount, 0),
    lastTrainedAt: models.reduce<Date | null>(
      (last, m) => (!last || m.trainedAt > last ? m.trainedAt : last),
      null,
    ),
  };
}

/** O período da medida: os últimos 30 dias, hoje incluído (datas civis de São Paulo). */
export function statsPeriod(now: Date = new Date()): { from: CivilDate; to: CivilDate } {
  const to = todayCivil(now);
  return { from: addDays(to, -(STATS_DAYS - 1)), to };
}

/**
 * Quem categorizou os lançamentos do período nas carteiras que a pessoa vê. Mesma regra da
 * lista (fora: excluídos, transferências e o que ainda espera revisão), para cada número levar
 * à lista que o compõe (`?quem=`). Categoria sem autor (anterior ao M07) conta como da pessoa.
 */
export async function categorizationStats(
  db: PrismaClient,
  scope: WalletScope<"view">,
  period: { from: CivilDate; to: CivilDate },
) {
  const where: Prisma.TransactionWhereInput = {
    walletId: { in: [...scope.walletIds] },
    deletedAt: null,
    transferId: null,
    status: { not: "PENDING" },
    occurredOn: { gte: dbDateFromCivil(period.from), lte: dbDateFromCivil(period.to) },
  };
  const [byAuthor, none] = await Promise.all([
    db.transaction.groupBy({
      by: ["categorizedBy"],
      where: { ...where, categoryId: { not: null } },
      _count: { _all: true },
    }),
    db.transaction.count({ where: { ...where, categoryId: null } }),
  ]);
  const counts: Partial<Record<BreakdownKey, number>> = { NONE: none };
  for (const row of byAuthor) {
    const key: BreakdownKey = row.categorizedBy ?? "MANUAL";
    counts[key] = (counts[key] ?? 0) + row._count._all;
  }
  return categorizationBreakdown(counts);
}
