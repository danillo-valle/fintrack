// Categorização inteligente contra o Postgres (M10.1, ADR-015): a camada do banco, o
// classificador por carteira (com uma porta de mentira no lugar do serviço Python), o treino,
// o preenchimento dos recebidos, a medida "quem categorizou" e as regras coladas na migração.
//
// Rode com: pnpm test:integration
import { matchText, type ClassifierPort, type TrainingExample } from "@fintrack/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  authorizeAccountUse,
  authorizeHousehold,
  authorizeScope,
  authorizeWallet,
} from "../access";
import { createRule, explainCategory, suggestCategory } from "../categories";
import {
  categorizationStats,
  CLASSIFIER_MIN_EXAMPLES,
  classifierSummary,
  trainingExamples,
  trainNow,
  trainWallet,
  walletsForTraining,
} from "../classifier";
import { createTransaction, listTransactions } from "../transactions";
import {
  auditActions,
  createTestCategories,
  createTestHousehold,
  dbError,
  deleteTestHousehold,
  insertTransaction,
  prisma,
  TEST_CTX,
  type TestHousehold,
} from "./fixtures";

/**
 * O serviço Python de mentira: "aprende" a categoria de cada texto (sem números) e responde com
 * 95 % para um texto conhecido; para um desconhecido, 40 %. Guarda a quem perguntaram.
 */
function fakeClassifier() {
  const models = new Map<string, Map<string, string>>();
  const asked: string[][] = [];
  const key = (text: string) => matchText(text).replace(/[0-9]/g, "").trim();
  const port: ClassifierPort = {
    async suggest({ models: names, description }) {
      asked.push([...names]);
      for (const name of names) {
        const found = models.get(name)?.get(key(description));
        if (found) return [{ categoryId: found, confidence: 95, model: name }];
      }
      const any = names.map((n) => models.get(n)).find(Boolean);
      const first = any ? [...any.values()][0] : undefined;
      return first ? [{ categoryId: first, confidence: 40, model: names[0] as string }] : [];
    },
    async train({ model, examples }: { model: string; examples: readonly TrainingExample[] }) {
      if (examples.length < CLASSIFIER_MIN_EXAMPLES) return "TOO_FEW";
      models.set(model, new Map(examples.map((e) => [key(e.description), e.categoryId])));
      return {
        examples: examples.length,
        categories: new Set(examples.map((e) => e.categoryId)).size,
      };
    },
    async remove(model) {
      models.delete(model);
    },
  };
  return { port, models, asked };
}

let h: TestHousehold;
let cats: Awaited<ReturnType<typeof createTestCategories>>;
beforeEach(async () => {
  h = await createTestHousehold();
  cats = await createTestCategories(h.householdId);
});
afterEach(async () => {
  await deleteTestHousehold(h);
});

/** N lançamentos confirmados e categorizados numa carteira: os exemplos de treino. */
async function history(walletId: string, description: string, categoryId: string, n: number) {
  for (let i = 0; i < n; i++) {
    await insertTransaction(h, {
      walletId,
      amount: "-10",
      occurredOn: `2026-10-${String((i % 28) + 1).padStart(2, "0")}`,
      description: `${description} ${i}`,
      categoryId,
    });
  }
}

const scopeOf = (userId: string) => authorizeScope(prisma, userId, "view");

describe("as regras coladas na migração", () => {
  it("confiança só de 0 a 100 e nunca numa escolha da pessoa", async () => {
    const t = await insertTransaction(h, {
      amount: "-5",
      occurredOn: "2026-10-01",
      description: "x",
      categoryId: cats.mercado.id,
    });
    const set = (data: object) => prisma.transaction.update({ where: { id: t.id }, data });
    expect(await dbError(set({ categorizedBy: "MANUAL", categorizationConfidence: 90 }))).toContain(
      "transaction_categorization_confidence_check",
    );
    expect(await dbError(set({ categorizedBy: null, categorizationConfidence: 90 }))).toContain(
      "transaction_categorization_confidence_check",
    );
    expect(
      await dbError(set({ categorizedBy: "CLASSIFIER", categorizationConfidence: 101 })),
    ).toContain("transaction_categorization_confidence_check");
    await set({ categorizedBy: "CLASSIFIER", categorizationConfidence: 92 });
    await set({ categorizedBy: "PROVIDER", categorizationConfidence: null });
  });

  it("modelo com poucos exemplos ou impressão digital fora do formato é recusado", async () => {
    const base = {
      householdId: h.householdId,
      walletId: h.home.id,
      trainedAt: new Date(),
      exampleCount: 20,
      categoryCount: 2,
      trainingHash: "a".repeat(64),
    };
    expect(
      await dbError(prisma.classifierModel.create({ data: { ...base, exampleCount: 19 } })),
    ).toContain("classifier_model_counts_check");
    expect(
      await dbError(prisma.classifierModel.create({ data: { ...base, categoryCount: 1 } })),
    ).toContain("classifier_model_counts_check");
    expect(
      await dbError(
        prisma.classifierModel.create({ data: { ...base, trainingHash: "A".repeat(64) } }),
      ),
    ).toContain("classifier_model_training_hash_check");
    await prisma.classifierModel.create({ data: base });
    // Um modelo por carteira
    expect(await dbError(prisma.classifierModel.create({ data: base }))).toContain("walletId");
  });
});

describe("a camada do banco (Meu Pluggy)", () => {
  it("o que a pessoa escolheu antes para o mesmo texto do banco, sem acento nem caixa", async () => {
    for (const said of ["Supermercados", "SUPERMERCADOS"]) {
      const t = await insertTransaction(h, {
        amount: "-20",
        occurredOn: "2026-10-01",
        description: `LOJA ${said}`,
        categoryId: cats.mercado.id,
      });
      await prisma.transaction.update({ where: { id: t.id }, data: { providerCategory: said } });
    }
    const suggestion = await suggestCategory(prisma, await scopeOf(h.holder.id), {
      description: "COMERCIAL NOVO 123",
      kind: "expense",
      providerCategory: "supermercádos",
    });
    expect(suggestion).toMatchObject({
      source: "PROVIDER",
      categoryId: cats.mercado.id,
      confidence: 100,
    });
  });

  it("sem votos, o mesmo nome de uma categoria do lar; depois do histórico", async () => {
    const scope = await scopeOf(h.holder.id);
    expect(
      await suggestCategory(prisma, scope, {
        description: "RESTAURANTE NOVO",
        kind: "expense",
        providerCategory: "Restaurantes",
      }),
    ).toMatchObject({ source: "PROVIDER", categoryId: cats.restaurante.id, confidence: 80 });
    // Com histórico do comerciante, o histórico vem antes do banco
    await history(h.home.id, "RESTAURANTE NOVO", cats.padaria.id, 2);
    expect(
      await suggestCategory(prisma, scope, {
        description: "RESTAURANTE NOVO",
        kind: "expense",
        providerCategory: "Restaurantes",
      }),
    ).toMatchObject({ source: "HISTORY", categoryId: cats.padaria.id });
  });

  it("o voto da carteira pessoal da outra pessoa não conta", async () => {
    for (let i = 0; i < 3; i++) {
      const t = await insertTransaction(h, {
        walletId: h.partnerWallet.id,
        amount: "-20",
        occurredOn: "2026-10-01",
        description: `X ${i}`,
        categoryId: cats.padaria.id,
      });
      await prisma.transaction.update({
        where: { id: t.id },
        data: { providerCategory: "Compras online" },
      });
    }
    const input = {
      description: "LOJA Y",
      kind: "expense" as const,
      providerCategory: "Compras online",
    };
    expect(await suggestCategory(prisma, await scopeOf(h.holder.id), input)).toBeNull();
    expect(await suggestCategory(prisma, await scopeOf(h.partner.id), input)).toMatchObject({
      source: "PROVIDER",
    });
  });
});

describe("o classificador: um modelo por carteira", () => {
  it("menos de 20 exemplos não treina; com 20, treina, registra e não treina de novo sem mudança", async () => {
    const fake = fakeClassifier();
    await history(h.home.id, "SUPERMERC BOM PRECO", cats.mercado.id, 10);
    expect(await trainWallet(prisma, fake.port, h.home.id)).toMatchObject({ status: "TOO_FEW" });
    await history(h.home.id, "POSTO ESTRELA", cats.restaurante.id, 10);
    const trained = await trainWallet(
      prisma,
      fake.port,
      h.home.id,
      new Date("2026-10-16T06:15:00Z"),
    );
    expect(trained).toMatchObject({ status: "TRAINED", examples: 20, categories: 2 });
    const row = await prisma.classifierModel.findUniqueOrThrow({ where: { walletId: h.home.id } });
    expect(row).toMatchObject({ exampleCount: 20, categoryCount: 2 });
    expect(row.trainingHash).toMatch(/^[0-9a-f]{64}$/);
    expect(await trainWallet(prisma, fake.port, h.home.id)).toMatchObject({ status: "UNCHANGED" });
    expect(await classifierSummary(prisma, await scopeOf(h.holder.id))).toEqual({
      models: 1,
      examples: 20,
      lastTrainedAt: new Date("2026-10-16T06:15:00Z"),
    });
  });

  it("o que a cascata sugeriu num recebido e ninguém conferiu não vira exemplo", async () => {
    await history(h.home.id, "PADARIA", cats.padaria.id, 3);
    const pending = await insertTransaction(h, {
      amount: "-5",
      occurredOn: "2026-10-02",
      description: "AUTO",
      categoryId: cats.mercado.id,
    });
    await prisma.transaction.update({
      where: { id: pending.id },
      data: { status: "PENDING", categorizedBy: "CLASSIFIER", categorizationConfidence: 90 },
    });
    const examples = await trainingExamples(prisma, h.home.id);
    expect(examples.map((e) => e.description)).not.toContain("AUTO");
    expect(examples).toHaveLength(3);
  });

  it("sugere com o modelo das carteiras que a pessoa vê, e só delas", async () => {
    const fake = fakeClassifier();
    await history(h.partnerWallet.id, "LOJA SECRETA", cats.padaria.id, 10);
    await history(h.partnerWallet.id, "OUTRA LOJA", cats.mercado.id, 10);
    await trainWallet(prisma, fake.port, h.partnerWallet.id);
    // "SECRETA99": o histórico não reconhece (a chave do comerciante muda), o classificador sim
    const input = { description: "LOJA SECRETA99", kind: "expense" as const };
    // A titular não vê a carteira pessoal da parceira: nem pergunta ao modelo dela
    const holder = await suggestCategory(prisma, await scopeOf(h.holder.id), input, {
      classifier: fake.port,
    });
    expect(holder).toBeNull();
    expect(fake.asked.flat()).not.toContain(h.partnerWallet.id);
    const partner = await suggestCategory(prisma, await scopeOf(h.partner.id), input, {
      classifier: fake.port,
    });
    expect(partner).toMatchObject({
      source: "CLASSIFIER",
      categoryId: cats.padaria.id,
      confidence: 95,
    });
  });

  it("abaixo de 80 % não sugere, e o motivo aparece na explicação", async () => {
    const fake = fakeClassifier();
    await history(h.home.id, "SUPERMERC BOM PRECO", cats.mercado.id, 10);
    await history(h.home.id, "POSTO ESTRELA", cats.restaurante.id, 10);
    await trainWallet(prisma, fake.port, h.home.id);
    const scope = await scopeOf(h.holder.id);
    const explained = await explainCategory(
      prisma,
      scope,
      { description: "NUNCA VISTO", kind: "expense" },
      { classifier: fake.port },
    );
    expect(explained.suggestion).toBeNull();
    expect(explained.layers.map((l) => [l.source, l.state])).toEqual([
      ["RULE", "MISSED"],
      ["HISTORY", "MISSED"],
      ["PROVIDER", "MISSED"],
      ["CLASSIFIER", "MISSED"],
    ]);
    expect(explained.layers[3]?.detail).toMatch(/ficou em 40 % \(sugere a partir de 80 %\)/);
  });

  it("serviço fora do ar: a cascata segue sem a camada, sem erro", async () => {
    const fake = fakeClassifier();
    await history(h.home.id, "A", cats.mercado.id, 10);
    await history(h.home.id, "B", cats.padaria.id, 10);
    await trainWallet(prisma, fake.port, h.home.id);
    const down: ClassifierPort = { ...fake.port, suggest: () => Promise.reject(new Error("fora")) };
    const explained = await explainCategory(
      prisma,
      await scopeOf(h.holder.id),
      { description: "QUALQUER", kind: "expense" },
      { classifier: down },
    );
    expect(explained.layers[3]?.detail).toBe("O classificador não respondeu");
  });

  it("depois de treinar, preenche os recebidos sem categoria DA carteira", async () => {
    const fake = fakeClassifier();
    await history(h.home.id, "SUPERMERC BOM PRECO", cats.mercado.id, 10);
    await history(h.home.id, "POSTO ESTRELA", cats.restaurante.id, 10);
    const make = async (walletId: string, description: string) => {
      const t = await insertTransaction(h, {
        walletId,
        amount: "-30",
        occurredOn: "2026-10-03",
        description,
      });
      await prisma.transaction.update({ where: { id: t.id }, data: { status: "PENDING" } });
      return t.id;
    };
    const known = await make(h.home.id, "SUPERMERC BOM PRECO 77");
    const unknown = await make(h.home.id, "LOJA NOVA");
    const elsewhere = await make(h.holderWallet.id, "SUPERMERC BOM PRECO 77");
    const outcome = await trainWallet(prisma, fake.port, h.home.id);
    expect(outcome).toMatchObject({ status: "TRAINED", filled: 1 });
    const rows = await prisma.transaction.findMany({
      where: { id: { in: [known, unknown, elsewhere] } },
      select: {
        id: true,
        categoryId: true,
        categorizedBy: true,
        categorizationConfidence: true,
        status: true,
      },
    });
    const byId = new Map(rows.map((r) => [r.id, r]));
    expect(byId.get(known)).toMatchObject({
      categoryId: cats.mercado.id,
      categorizedBy: "CLASSIFIER",
      categorizationConfidence: 95,
      status: "PENDING",
    });
    expect(byId.get(unknown)?.categoryId).toBeNull();
    expect(byId.get(elsewhere)?.categoryId).toBeNull();
  });

  it("carteira arquivada perde o modelo (no banco e no serviço)", async () => {
    const fake = fakeClassifier();
    await history(h.home.id, "A", cats.mercado.id, 10);
    await history(h.home.id, "B", cats.padaria.id, 10);
    await trainWallet(prisma, fake.port, h.home.id);
    await prisma.wallet.update({ where: { id: h.home.id }, data: { archivedAt: new Date() } });
    expect(await walletsForTraining(prisma, h.householdId)).toContain(h.home.id);
    await trainWallet(prisma, fake.port, h.home.id);
    expect(await prisma.classifierModel.count({ where: { walletId: h.home.id } })).toBe(0);
    expect(fake.models.has(h.home.id)).toBe(false);
    expect(await walletsForTraining(prisma, h.householdId)).not.toContain(h.home.id);
  });

  it("Treinar agora: só as carteiras que a pessoa vê, com auditoria só de contagens", async () => {
    const fake = fakeClassifier();
    await history(h.partnerWallet.id, "A", cats.mercado.id, 10);
    await history(h.partnerWallet.id, "B", cats.padaria.id, 10);
    const grant = await authorizeHousehold(prisma, h.holder.id, "manage_categories");
    if (!grant.ok) throw new Error("crachá");
    const outcomes = await trainNow(
      prisma,
      fake.port,
      grant.grant,
      await scopeOf(h.holder.id),
      TEST_CTX,
    );
    expect(outcomes.map((o) => o.walletId)).not.toContain(h.partnerWallet.id);
    expect(await auditActions(h.householdId)).toContain("classifier.trained");
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { householdId: h.householdId, action: "classifier.trained" },
    });
    expect(Object.keys(audit.metadata as object).sort()).toEqual(["failed", "trained", "wallets"]);
  });
});

describe("quem categorizou: a sugestão aceita grava a camada e a confiança", () => {
  it("aceitar o classificador grava CLASSIFIER e 95; escolher outra grava MANUAL e vira exemplo", async () => {
    const fake = fakeClassifier();
    await history(h.home.id, "SUPERMERC BOM PRECO", cats.mercado.id, 10);
    await history(h.home.id, "POSTO ESTRELA", cats.restaurante.id, 10);
    await trainWallet(prisma, fake.port, h.home.id);
    const wallet = await authorizeWallet(prisma, h.holder.id, h.home.id, "edit");
    const account = await authorizeAccountUse(prisma, h.holder.id, h.checking.id);
    if (!wallet.ok || !account.ok) throw new Error("crachás");
    const options = { scope: await scopeOf(h.holder.id), services: { classifier: fake.port } };
    const launch = (categoryId: string) =>
      createTransaction(
        prisma,
        wallet.grant,
        account.grant,
        {
          kind: "expense",
          cents: 1500n,
          description: "SUPERMERC BOM PRECO31", // o histórico não reconhece; o classificador sim
          occurredOn: "2026-10-16",
          categoryId,
        },
        options,
        TEST_CTX,
      );
    const accepted = await launch(cats.mercado.id);
    const changed = await launch(cats.padaria.id);
    const rows = await prisma.transaction.findMany({
      where: { id: { in: [accepted.id, changed.id] } },
      select: { id: true, categorizedBy: true, categorizationConfidence: true },
    });
    expect(rows.find((r) => r.id === accepted.id)).toMatchObject({
      categorizedBy: "CLASSIFIER",
      categorizationConfidence: 95,
    });
    expect(rows.find((r) => r.id === changed.id)).toMatchObject({
      categorizedBy: "MANUAL",
      categorizationConfidence: null,
    });
    const example = await prisma.categorizationExample.findFirstOrThrow({
      where: { transactionId: changed.id },
    });
    expect(example).toMatchObject({ fromSource: "CLASSIFIER", toCategoryId: cats.padaria.id });
  });
});

describe("a medida: o percentual sem IA e cada número leva à lista", () => {
  it("conta por camada, fora recebidos, transferências e excluídos, e a lista concorda", async () => {
    const add = async (
      description: string,
      categorizedBy: "RULE" | "HISTORY" | "PROVIDER" | "CLASSIFIER" | "MANUAL" | null,
      extra: { categoryId?: string | null; status?: "PENDING"; deleted?: boolean } = {},
    ) => {
      const t = await insertTransaction(h, {
        amount: "-10",
        occurredOn: "2026-10-10",
        description,
        categoryId: extra.categoryId === undefined ? cats.mercado.id : extra.categoryId,
        deletedAt: extra.deleted ? new Date() : null,
      });
      await prisma.transaction.update({
        where: { id: t.id },
        data: { categorizedBy, ...(extra.status ? { status: extra.status } : {}) },
      });
    };
    await add("r1", "RULE");
    await add("r2", "RULE");
    await add("h1", "HISTORY");
    await add("p1", "PROVIDER");
    await add("c1", "CLASSIFIER");
    await add("c2", "CLASSIFIER");
    await add("m1", "MANUAL");
    await add("antigo", null); // categoria sem autor (antes do M07): conta como da pessoa
    await add("sem", null, { categoryId: null });
    await add("recebido", "CLASSIFIER", { status: "PENDING" });
    await add("apagado", "RULE", { deleted: true });
    await insertTransaction(h, {
      amount: "-50",
      occurredOn: "2026-10-10",
      description: "transf",
      transferId: crypto.randomUUID(),
    });
    const scope = await scopeOf(h.holder.id);
    const period = { from: "2026-09-17", to: "2026-10-16" } as const;
    const stats = await categorizationStats(prisma, scope, period);
    const count = Object.fromEntries(stats.rows.map((r) => [r.key, r.count]));
    expect(count).toEqual({ RULE: 2, HISTORY: 1, PROVIDER: 1, CLASSIFIER: 2, MANUAL: 2, NONE: 1 });
    expect(stats).toMatchObject({ total: 9, automatic: 6, automaticTenths: 667 });

    for (const key of ["RULE", "HISTORY", "PROVIDER", "CLASSIFIER", "MANUAL"] as const) {
      const list = await listTransactions(prisma, scope, { ...period, categorizedBy: key });
      expect(list.items.length, key).toBe(count[key]);
    }
    const none = await listTransactions(prisma, scope, { ...period, categoryId: "none" });
    expect(none.items.length).toBe(1);
  });
});

describe("a regra continua vencendo tudo", () => {
  it("regra > histórico > banco > classificador", async () => {
    const fake = fakeClassifier();
    await history(h.home.id, "SUPERMERC BOM PRECO", cats.mercado.id, 10);
    await history(h.home.id, "POSTO ESTRELA", cats.restaurante.id, 10);
    await trainWallet(prisma, fake.port, h.home.id);
    const g = await authorizeHousehold(prisma, h.holder.id, "manage_categories");
    if (!g.ok) throw new Error("crachá");
    await createRule(
      prisma,
      g.grant,
      { categoryId: cats.padaria.id, pattern: "supermerc", match: "CONTAINS" },
      TEST_CTX,
    );
    const out = await suggestCategory(
      prisma,
      await scopeOf(h.holder.id),
      { description: "SUPERMERC BOM PRECO 1", kind: "expense", providerCategory: "Restaurantes" },
      { classifier: fake.port },
    );
    expect(out).toMatchObject({ source: "RULE", categoryId: cats.padaria.id, confidence: 100 });
  });
});
