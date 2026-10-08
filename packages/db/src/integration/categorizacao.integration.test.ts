// Categorização contra o Postgres (M07): a cascata (regras → histórico), quem categorizou,
// a correção virando exemplo de treino e regra, e o histórico que NUNCA vaza carteira alheia.
//
// Rode com: pnpm test:integration
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  authorizeAccountUse,
  authorizeHousehold,
  authorizeScope,
  authorizeTransaction,
  authorizeWallet,
  DomainError,
} from "../access";
import {
  createCategory,
  createRule,
  deleteRule,
  listCategories,
  setCategoryArchived,
  suggestCategory,
} from "../categories";
import { createTransaction, updateTransaction } from "../transactions";
import {
  auditActions,
  createTestCategories,
  createTestHousehold,
  deleteTestHousehold,
  insertTransaction,
  prisma,
  TEST_CTX,
  type TestHousehold,
} from "./fixtures";

let h: TestHousehold;
let cats: Awaited<ReturnType<typeof createTestCategories>>;
beforeEach(async () => {
  h = await createTestHousehold();
  cats = await createTestCategories(h.householdId);
});
afterEach(async () => {
  await deleteTestHousehold(h);
});

async function grants(userId: string, walletId = h.home.id, accountId = h.checking.id) {
  const wallet = await authorizeWallet(prisma, userId, walletId, "edit");
  const account = await authorizeAccountUse(prisma, userId, accountId);
  const categories = await authorizeHousehold(prisma, userId, "manage_categories");
  if (!wallet.ok || !account.ok || !categories.ok) throw new Error("crachás do teste");
  return {
    wallet: wallet.grant,
    account: account.grant,
    categories: categories.grant,
    scope: await authorizeScope(prisma, userId, "view"),
  };
}

/** Lança como a titular, escolhendo (ou não) a categoria. */
async function launch(description: string, categoryId: string | null, rememberRule = false) {
  const g = await grants(h.holder.id);
  return createTransaction(
    prisma,
    g.wallet,
    g.account,
    { kind: "expense", cents: 1000n, description, occurredOn: "2026-10-07", categoryId },
    { scope: g.scope, rememberRule: rememberRule ? { grant: g.categories } : null },
    TEST_CTX,
  );
}

async function ruleFor(pattern: string, categoryId: string) {
  const g = await grants(h.holder.id);
  return createRule(prisma, g.categories, { categoryId, pattern, match: "CONTAINS" }, TEST_CTX);
}

describe("a cascata: regra primeiro, histórico depois", () => {
  it("regra vence o histórico", async () => {
    for (let i = 0; i < 3; i++) {
      await insertTransaction(h, {
        amount: "-5",
        occurredOn: "2026-10-01",
        description: "Padaria Pão Bom",
        categoryId: cats.mercado.id,
      });
    }
    await ruleFor("pao bom", cats.padaria.id);
    const s = await suggestCategory(prisma, await authorizeScope(prisma, h.holder.id, "view"), {
      description: "PADARIA PÃO BOM 02/10",
      kind: "expense",
    });
    expect(s).toMatchObject({ categoryId: cats.padaria.id, source: "RULE", confidence: 100 });
  });

  it("sem regra, o histórico sugere a categoria mais usada para o mesmo comerciante", async () => {
    for (const categoryId of [cats.restaurante.id, cats.restaurante.id, cats.mercado.id]) {
      await insertTransaction(h, {
        amount: "-5",
        occurredOn: "2026-10-01",
        description: "Cantina da Vila",
        categoryId,
      });
    }
    const s = await suggestCategory(prisma, await authorizeScope(prisma, h.holder.id, "view"), {
      description: "CANTINA DA VILA",
      kind: "expense",
    });
    expect(s).toMatchObject({ categoryId: cats.restaurante.id, source: "HISTORY", confidence: 66 });
  });

  it("regra de categoria de receita não sugere numa despesa (e vice-versa)", async () => {
    await ruleFor("empresa", cats.salario.id);
    const scope = await authorizeScope(prisma, h.holder.id, "view");
    expect(
      await suggestCategory(prisma, scope, { description: "Empresa X", kind: "expense" }),
    ).toBeNull();
    expect(
      (await suggestCategory(prisma, scope, { description: "Empresa X", kind: "income" }))
        ?.categoryId,
    ).toBe(cats.salario.id);
  });

  it("categoria arquivada sai da sugestão (regra e histórico)", async () => {
    await ruleFor("mercado", cats.mercado.id);
    await prisma.category.update({
      where: { id: cats.mercado.id },
      data: { archivedAt: new Date() },
    });
    const scope = await authorizeScope(prisma, h.holder.id, "view");
    expect(
      await suggestCategory(prisma, scope, { description: "Mercado", kind: "expense" }),
    ).toBeNull();
  });
});

describe("o histórico não vaza carteira alheia (canal lateral)", () => {
  it("compras da carteira PESSOAL da titular não viram sugestão para a parceira", async () => {
    for (let i = 0; i < 3; i++) {
      await insertTransaction(h, {
        walletId: h.holderWallet.id,
        amount: "-5",
        occurredOn: "2026-10-01",
        description: "Loja Secreta",
        categoryId: cats.restaurante.id,
      });
    }
    const input = { description: "Loja Secreta", kind: "expense" as const };
    // A titular vê a própria carteira: recebe a sugestão
    expect(
      (await suggestCategory(prisma, await authorizeScope(prisma, h.holder.id, "view"), input))
        ?.source,
    ).toBe("HISTORY");
    // A parceira é do mesmo lar, mas não vê a pessoal da titular: nada
    expect(
      await suggestCategory(prisma, await authorizeScope(prisma, h.partner.id, "view"), input),
    ).toBeNull();
  });
});

describe("quem categorizou e os exemplos de treino", () => {
  it("aceitou a sugestão: categorizedBy = RULE, sem exemplo de treino", async () => {
    await ruleFor("mercado", cats.mercado.id);
    const { id } = await launch("Mercado Dia", cats.mercado.id);
    const row = await prisma.transaction.findUniqueOrThrow({ where: { id } });
    expect(row.categorizedBy).toBe("RULE");
    expect(
      await prisma.categorizationExample.count({ where: { householdId: h.householdId } }),
    ).toBe(0);
  });

  it("escolheu outra: MANUAL e um exemplo (de onde → para onde, quem tinha sugerido)", async () => {
    await ruleFor("mercado", cats.mercado.id);
    const { id } = await launch("Mercado Bar do Zé", cats.restaurante.id);
    const row = await prisma.transaction.findUniqueOrThrow({ where: { id } });
    expect(row.categorizedBy).toBe("MANUAL");
    const example = await prisma.categorizationExample.findFirstOrThrow({
      where: { transactionId: id },
    });
    expect(example).toMatchObject({
      description: "Mercado Bar do Zé",
      isExpense: true,
      fromCategoryId: cats.mercado.id,
      fromSource: "RULE",
      toCategoryId: cats.restaurante.id,
      createdById: h.holder.id,
    });
  });

  it("sem sugestão, escolher não é correção (o lançamento já é o exemplo)", async () => {
    await launch("Coisa nova", cats.mercado.id);
    expect(
      await prisma.categorizationExample.count({ where: { householdId: h.householdId } }),
    ).toBe(0);
  });

  it("'sempre categorizar assim': a correção cria a regra, e a próxima sugestão já usa", async () => {
    await ruleFor("mercado", cats.mercado.id);
    await launch("COMPRA CARTAO - MERCADO BAR DO ZE 4432", cats.restaurante.id, true);
    const rule = await prisma.categoryRule.findFirstOrThrow({
      where: { householdId: h.householdId, categoryId: cats.restaurante.id },
    });
    expect(rule.pattern).toBe("mercado bar do");
    expect(await auditActions(h.householdId)).toContain("category_rule.created");
    // "mercado bar do" é mais longo que "mercado": vence no empate de prioridade
    const s = await suggestCategory(prisma, await authorizeScope(prisma, h.holder.id, "view"), {
      description: "Mercado Bar do Zé",
      kind: "expense",
    });
    expect(s?.categoryId).toBe(cats.restaurante.id);
  });

  it("editar a categoria gravada é correção: exemplo com a categoria anterior", async () => {
    const { id } = await launch("Feira do Bairro", cats.mercado.id);
    const access = await authorizeTransaction(prisma, h.holder.id, id, "edit");
    if (!access.ok) throw new Error("crachá");
    const g = await grants(h.holder.id);
    await updateTransaction(
      prisma,
      access.grant,
      g.wallet,
      g.account,
      {
        kind: "expense",
        cents: 1000n,
        description: "Feira do Bairro",
        occurredOn: "2026-10-07",
        categoryId: cats.padaria.id,
      },
      { scope: g.scope },
      TEST_CTX,
    );
    const example = await prisma.categorizationExample.findFirstOrThrow({
      where: { transactionId: id },
    });
    expect([example.fromCategoryId, example.fromSource, example.toCategoryId]).toEqual([
      cats.mercado.id,
      "MANUAL",
      cats.padaria.id,
    ]);
    const row = await prisma.transaction.findUniqueOrThrow({ where: { id } });
    expect(row.categorizedBy).toBe("MANUAL");
  });
});

describe("categorias e regras do lar", () => {
  it("membro do lar também organiza; nome repetido: CATEGORY_EXISTS", async () => {
    const g = await grants(h.partner.id, h.home.id, h.voucher.id);
    await createCategory(prisma, g.categories, { name: "Pets", kind: "EXPENSE" }, TEST_CTX);
    const error = await createCategory(
      prisma,
      g.categories,
      { name: "Pets", kind: "EXPENSE" },
      TEST_CTX,
    ).catch((e) => e);
    expect((error as DomainError).code).toBe("CATEGORY_EXISTS");
    expect(await auditActions(h.householdId)).toContain("category.created");
  });

  it("subcategoria precisa de pai do mesmo tipo; pai com filhas ativas não arquiva", async () => {
    const g = await grants(h.holder.id);
    const bad = await createCategory(
      prisma,
      g.categories,
      { name: "Hora extra", kind: "INCOME", parentId: cats.mercado.id },
      TEST_CTX,
    ).catch((e) => e);
    expect((bad as DomainError).code).toBe("CATEGORY_INVALID");
    await createCategory(
      prisma,
      g.categories,
      { name: "Hortifruti", kind: "EXPENSE", parentId: cats.mercado.id },
      TEST_CTX,
    );
    const error = await setCategoryArchived(
      prisma,
      g.categories,
      cats.mercado.id,
      true,
      TEST_CTX,
    ).catch((e) => e);
    expect((error as DomainError).code).toBe("CATEGORY_IN_USE_AS_PARENT");
  });

  it("arquivar esconde a categoria da lista, mas o lançamento antigo continua com ela", async () => {
    const { id } = await launch("Pão", cats.padaria.id);
    const g = await grants(h.holder.id);
    await setCategoryArchived(prisma, g.categories, cats.padaria.id, true, TEST_CTX);
    const view = await authorizeHousehold(prisma, h.holder.id, "view");
    if (!view.ok) throw new Error("crachá");
    expect((await listCategories(prisma, view.grant)).map((c) => c.name)).not.toContain("Padaria");
    expect((await prisma.transaction.findUniqueOrThrow({ where: { id } })).categoryId).toBe(
      cats.padaria.id,
    );
  });

  it("regra: padrão curto demais é recusado; apagar regra de outro lar: NOT_FOUND", async () => {
    const g = await grants(h.holder.id);
    const short = await createRule(
      prisma,
      g.categories,
      { categoryId: cats.mercado.id, pattern: " x ", match: "CONTAINS" },
      TEST_CTX,
    ).catch((e) => e);
    expect((short as DomainError).code).toBe("RULE_PATTERN_INVALID");

    const other = await createTestHousehold();
    try {
      const foreignCats = await createTestCategories(other.householdId);
      const foreignGrant = await authorizeHousehold(prisma, other.holder.id, "manage_categories");
      if (!foreignGrant.ok) throw new Error("crachá");
      const foreignRule = await createRule(
        prisma,
        foreignGrant.grant,
        { categoryId: foreignCats.mercado.id, pattern: "mercado", match: "CONTAINS" },
        TEST_CTX,
      );
      const error = await deleteRule(prisma, g.categories, foreignRule.id, TEST_CTX).catch(
        (e) => e,
      );
      expect((error as DomainError).code).toBe("NOT_FOUND");
    } finally {
      await deleteTestHousehold(other);
    }
  });
});
