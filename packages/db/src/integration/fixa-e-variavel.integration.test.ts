// M13.3b contra o Postgres (ADR-026): o tipo da despesa (NATURE_SQL × natureOf), o CHECK da marca,
// a regra da loja com o tipo ("as próximas também"), a marca num toque, as fixas do previsto e a
// limpeza das categorias que eram transferência com o Desfazer.
//
// Rode com: pnpm test:integration
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  authorizeHousehold,
  authorizeScope,
  authorizeTransaction,
  DomainError,
  type HouseholdGrant,
  type WalletScope,
} from "../access";
import { rememberRuleTx, ruleSuggester, updateCategory } from "../categories";
import { applyCleanup, findCleanups, undoCleanup } from "../category-cleanup";
import { fixedCharges } from "../dashboard";
import { Prisma } from "../generated/prisma/client";
import { NATURE_SELECT, NATURE_SQL, natureOf } from "../nature";
import { setTransactionNature } from "../transactions";
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

async function codeOf(promise: Promise<unknown>): Promise<string> {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  if (!(error instanceof DomainError))
    throw new Error(`esperava DomainError, veio ${String(error)}`);
  return error.code;
}

let h: TestHousehold;
let cats: Awaited<ReturnType<typeof createTestCategories>>;
let manager: HouseholdGrant<"manage_categories">;
let editScope: WalletScope<"edit">;
let viewScope: WalletScope<"view">;

beforeEach(async () => {
  h = await createTestHousehold();
  cats = await createTestCategories(h.householdId);
  const access = await authorizeHousehold(prisma, h.holder.id, "manage_categories");
  if (!access.ok) throw new Error("sem acesso");
  manager = access.grant;
  editScope = await authorizeScope(prisma, h.holder.id, "edit");
  viewScope = await authorizeScope(prisma, h.holder.id, "view");
});
afterEach(async () => {
  await deleteTestHousehold(h);
});

async function editGrant(id: string) {
  const access = await authorizeTransaction(prisma, h.holder.id, id, "edit");
  if (!access.ok) throw new Error("sem acesso");
  return access.grant;
}

describe("o tipo da despesa (ADR-026)", () => {
  it("NATURE_SQL e natureOf concordam lançamento por lançamento", async () => {
    await prisma.category.update({
      where: { id: cats.restaurante.id },
      data: { defaultNature: "FIXED" },
    });
    const recurrence = await prisma.recurrence.create({
      data: {
        householdId: h.householdId,
        walletId: h.home.id,
        accountId: h.checking.id,
        method: "PIX",
        amount: "-1800.00",
        description: "Aluguel",
        kind: "FIXED_BILL",
        dayOfMonth: 5,
        startsOn: new Date("2026-10-01T00:00:00Z"),
        createdById: h.holder.id,
      },
    });
    const base = { occurredOn: "2026-10-10", description: "Compra" };
    const rows = await Promise.all([
      insertTransaction(h, { ...base, amount: "-10.00", categoryId: cats.mercado.id }),
      insertTransaction(h, { ...base, amount: "-11.00", categoryId: cats.restaurante.id }),
      insertTransaction(h, { ...base, amount: "-12.00", categoryId: null }),
    ]);
    const [, , none] = rows;
    await prisma.transaction.update({ where: { id: none!.id }, data: { nature: "FIXED" } });
    const marked = await insertTransaction(h, {
      ...base,
      amount: "-13.00",
      categoryId: cats.restaurante.id,
    });
    await prisma.transaction.update({ where: { id: marked.id }, data: { nature: "VARIABLE" } });
    const fromRecurrence = await insertTransaction(h, { ...base, amount: "-1800.00" });
    await prisma.transaction.update({
      where: { id: fromRecurrence.id },
      data: { recurrenceId: recurrence.id },
    });
    const parcel = await insertTransaction(h, {
      ...base,
      amount: "-14.00",
      categoryId: cats.restaurante.id,
    });
    await prisma.transaction.update({
      where: { id: parcel.id },
      data: { providerInstallmentNumber: 2, providerInstallmentCount: 6 },
    });

    const viaPrisma = await prisma.transaction.findMany({
      where: { householdId: h.householdId },
      select: { id: true, ...NATURE_SELECT },
    });
    const viaSql = await prisma.$queryRaw<{ id: string; nature: string }[]>(Prisma.sql`
      SELECT t."id"::text AS "id", ${NATURE_SQL} AS "nature"
      FROM "transaction" t WHERE t."householdId" = ${h.householdId}::uuid`);
    const sql = new Map(viaSql.map((r) => [r.id, r.nature]));
    expect(viaPrisma).toHaveLength(6);
    for (const row of viaPrisma) expect(sql.get(row.id)).toBe(natureOf(row));
    expect(new Set(viaPrisma.map(natureOf))).toEqual(new Set(["fixed", "variable", "installment"]));
  });

  it("o CHECK recusa marca em parcela e em transferência", async () => {
    const parcel = await insertTransaction(h, {
      amount: "-14.00",
      occurredOn: "2026-10-10",
      description: "LOJA 02/06",
    });
    await prisma.transaction.update({
      where: { id: parcel.id },
      data: { providerInstallmentNumber: 2, providerInstallmentCount: 6 },
    });
    expect(
      await dbError(
        prisma.transaction.update({ where: { id: parcel.id }, data: { nature: "FIXED" } }),
      ),
    ).toContain("transaction_nature_check");
    const transfer = await insertTransaction(h, {
      amount: "-50.00",
      occurredOn: "2026-10-10",
      description: "TRANSF",
      transferId: randomUUID(),
    });
    expect(
      await dbError(
        prisma.transaction.update({ where: { id: transfer.id }, data: { nature: "VARIABLE" } }),
      ),
    ).toContain("transaction_nature_check");
  });
});

describe("a marca num toque e as próximas desta loja (ADR-026)", () => {
  it("marca fixa; com as próximas, a regra da loja passa a dar a categoria e o tipo", async () => {
    const netflix = await insertTransaction(h, {
      amount: "-55.90",
      occurredOn: "2026-10-02",
      description: "NETFLIX.COM 1234",
      categoryId: cats.restaurante.id,
    });
    await setTransactionNature(
      prisma,
      await editGrant(netflix.id),
      "FIXED",
      { rememberRule: { grant: manager } },
      TEST_CTX,
    );
    expect((await prisma.transaction.findUniqueOrThrow({ where: { id: netflix.id } })).nature).toBe(
      "FIXED",
    );
    const rules = await prisma.categoryRule.findMany({ where: { householdId: h.householdId } });
    expect(rules).toMatchObject([
      { pattern: "netflix com", categoryId: cats.restaurante.id, nature: "FIXED" },
    ]);
    const suggestion = await ruleSuggester(prisma, viewScope).suggest({
      description: "NETFLIX.COM 9876",
      kind: "expense",
    });
    expect(suggestion).toMatchObject({
      categoryId: cats.restaurante.id,
      nature: "FIXED",
    });

    // A mesma loja de novo: a regra muda (não nasce outra); sem tipo definido, o tipo fica
    await prisma.$transaction((tx) =>
      rememberRuleTx(
        tx,
        manager,
        { description: "NETFLIX.COM 5555", categoryId: cats.mercado.id },
        TEST_CTX,
      ),
    );
    expect(
      await prisma.categoryRule.findMany({ where: { householdId: h.householdId } }),
    ).toMatchObject([{ categoryId: cats.mercado.id, nature: "FIXED" }]);
    expect(await auditActions(h.householdId)).toEqual(
      expect.arrayContaining([
        "transaction.nature_set",
        "category_rule.created",
        "category_rule.updated",
      ]),
    );
  });

  it("receita, parcela e transferência não têm fixa/variável", async () => {
    const salary = await insertTransaction(h, {
      amount: "5000.00",
      occurredOn: "2026-10-05",
      description: "SALARIO",
    });
    expect(
      await codeOf(setTransactionNature(prisma, await editGrant(salary.id), "FIXED", {}, TEST_CTX)),
    ).toBe("NATURE_NOT_ALLOWED");
    const parcel = await insertTransaction(h, {
      amount: "-14.00",
      occurredOn: "2026-10-10",
      description: "LOJA 02/06",
    });
    await prisma.transaction.update({
      where: { id: parcel.id },
      data: { providerInstallmentNumber: 2, providerInstallmentCount: 6 },
    });
    expect(
      await codeOf(setTransactionNature(prisma, await editGrant(parcel.id), "FIXED", {}, TEST_CTX)),
    ).toBe("NATURE_NOT_ALLOWED");
  });

  it("o padrão da categoria muda as compras sem marca; virar receita tira o tipo das regras", async () => {
    await prisma.$transaction((tx) =>
      rememberRuleTx(
        tx,
        manager,
        { description: "PADARIA PAO QUENTE", categoryId: cats.padaria.id, nature: "FIXED" },
        TEST_CTX,
      ),
    );
    await updateCategory(
      prisma,
      manager,
      cats.padaria.id,
      { name: "Padaria", kind: "EXPENSE", defaultNature: "FIXED" },
      TEST_CTX,
    );
    expect(
      (await prisma.category.findUniqueOrThrow({ where: { id: cats.padaria.id } })).defaultNature,
    ).toBe("FIXED");
    await updateCategory(
      prisma,
      manager,
      cats.padaria.id,
      { name: "Padaria", kind: "INCOME", defaultNature: "FIXED" },
      TEST_CTX,
    );
    const after = await prisma.category.findUniqueOrThrow({ where: { id: cats.padaria.id } });
    expect(after.defaultNature).toBe("VARIABLE");
    expect(
      (await prisma.categoryRule.findFirstOrThrow({ where: { categoryId: cats.padaria.id } }))
        .nature,
    ).toBeNull();
  });
});

describe("as fixas do previsto (ADR-026)", () => {
  it("só as saídas fixas do mês passado e do mês, pela data de caixa", async () => {
    await prisma.category.update({
      where: { id: cats.restaurante.id },
      data: { defaultNature: "FIXED" },
    });
    await Promise.all([
      insertTransaction(h, {
        amount: "-55.90",
        occurredOn: "2026-10-02",
        description: "NETFLIX.COM",
        categoryId: cats.restaurante.id,
      }),
      insertTransaction(h, {
        amount: "-55.90",
        occurredOn: "2026-11-02",
        description: "NETFLIX.COM",
        categoryId: cats.restaurante.id,
      }),
      insertTransaction(h, {
        amount: "-37.40",
        occurredOn: "2026-11-03",
        description: "MERCADO",
        categoryId: cats.mercado.id,
      }),
      insertTransaction(h, {
        amount: "-99.00",
        occurredOn: "2026-09-02",
        description: "ACADEMIA",
        categoryId: cats.restaurante.id,
      }),
    ]);
    const charges = await fixedCharges(prisma, viewScope, "2026-11");
    expect(charges.map((c) => [c.month, c.description, c.expense]).toSorted()).toEqual([
      ["2026-10", "NETFLIX.COM", 5590n],
      ["2026-11", "NETFLIX.COM", 5590n],
    ]);
  });
});

describe("a limpeza das categorias que eram transferência (ADR-026)", () => {
  async function savingsWithResgates() {
    const savings = await prisma.financialAccount.create({
      data: {
        householdId: h.householdId,
        walletId: h.holderWallet.id,
        holderId: h.holder.id,
        name: "Poupança",
        kind: "SAVINGS",
      },
    });
    const resgate = await prisma.category.create({
      data: { householdId: h.householdId, name: "Resgate Poupança", kind: "INCOME" },
    });
    const side = (
      accountId: string,
      amount: string,
      occurredOn: string,
      categoryId: string | null,
    ) =>
      insertTransaction(h, {
        walletId: h.holderWallet.id,
        accountId,
        amount,
        occurredOn,
        description: "RESGATE",
        categoryId,
      });
    const rows = await Promise.all([
      side(savings.id, "-500.00", "2026-10-05", null),
      side(h.checking.id, "500.00", "2026-10-06", resgate.id),
      side(savings.id, "-200.00", "2026-09-10", null),
      side(h.checking.id, "200.00", "2026-09-10", resgate.id),
      side(h.checking.id, "300.00", "2026-08-01", resgate.id),
    ]);
    return { resgate, rows };
  }

  it("acha, converte (pares e um lado só), arquiva e o Desfazer devolve tudo", async () => {
    const { resgate, rows } = await savingsWithResgates();
    const found = await findCleanups(prisma, manager, editScope, "2026-11-04");
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ category: { id: resgate.id }, count: 3, paired: 2 });
    expect(found[0]!.pairs).toHaveLength(2);
    expect(found[0]!.oneSided).toHaveLength(1);

    expect(
      await codeOf(
        applyCleanup(
          prisma,
          manager,
          editScope,
          { categoryId: resgate.id, expectedCount: 2, archive: true },
          TEST_CTX,
          "2026-11-04",
        ),
      ),
    ).toBe("REVIEW_STALE");
    const done = await applyCleanup(
      prisma,
      manager,
      editScope,
      { categoryId: resgate.id, expectedCount: 3, archive: true },
      TEST_CTX,
      "2026-11-04",
    );
    expect(done).toMatchObject({ count: 5, archived: true });
    const after = await prisma.transaction.findMany({
      where: { id: { in: rows.map((r) => r.id) } },
      orderBy: { amount: "asc" },
    });
    expect(after.every((t) => t.transferId !== null && t.categoryId === null)).toBe(true);
    expect(after.filter((t) => t.transferPeer === "EXTERNAL")).toHaveLength(1);
    expect(new Set(after.map((t) => t.transferId)).size).toBe(3);
    expect(
      (await prisma.category.findUniqueOrThrow({ where: { id: resgate.id } })).archivedAt,
    ).not.toBeNull();
    expect(await findCleanups(prisma, manager, editScope, "2026-11-04")).toEqual([]);

    await undoCleanup(prisma, manager, editScope, done.cleanupId, TEST_CTX);
    const undone = await prisma.transaction.findMany({
      where: { id: { in: rows.map((r) => r.id) } },
    });
    for (const t of undone) {
      const before = rows.find((r) => r.id === t.id)!;
      expect([t.transferId, t.transferPeer, t.categoryId]).toEqual([null, null, before.categoryId]);
    }
    expect(
      (await prisma.category.findUniqueOrThrow({ where: { id: resgate.id } })).archivedAt,
    ).toBeNull();
    expect(await codeOf(undoCleanup(prisma, manager, editScope, done.cleanupId, TEST_CTX))).toBe(
      "UNDO_EXPIRED",
    );
    expect(await auditActions(h.householdId)).toEqual(
      expect.arrayContaining(["category.cleanup", "category.cleanup_undone"]),
    );
  });

  it("só as carteiras que a pessoa edita; a limpeza de outro lar responde NOT_FOUND", async () => {
    const { resgate } = await savingsWithResgates();
    // Um resgate na carteira pessoal da parceira (que o titular não vê) não entra nem é tocado
    const theirs = await insertTransaction(h, {
      walletId: h.partnerWallet.id,
      accountId: h.checking.id,
      amount: "700.00",
      occurredOn: "2026-10-12",
      description: "RESGATE",
      categoryId: resgate.id,
    });
    const found = await findCleanups(prisma, manager, editScope, "2026-11-04");
    expect(found[0]?.count).toBe(3);
    const done = await applyCleanup(
      prisma,
      manager,
      editScope,
      { categoryId: resgate.id, expectedCount: 3, archive: false },
      TEST_CTX,
      "2026-11-04",
    );
    expect(
      (await prisma.transaction.findUniqueOrThrow({ where: { id: theirs.id } })).transferId,
    ).toBeNull();

    const other = await createTestHousehold();
    try {
      const access = await authorizeHousehold(prisma, other.holder.id, "manage_categories");
      if (!access.ok) throw new Error("sem acesso");
      const otherScope = await authorizeScope(prisma, other.holder.id, "edit");
      expect(
        await codeOf(undoCleanup(prisma, access.grant, otherScope, done.cleanupId, TEST_CTX)),
      ).toBe("NOT_FOUND");
      expect(
        await codeOf(
          applyCleanup(
            prisma,
            access.grant,
            otherScope,
            { categoryId: resgate.id, expectedCount: 3, archive: false },
            TEST_CTX,
            "2026-11-04",
          ),
        ),
      ).toBe("NOT_FOUND");
    } finally {
      await deleteTestHousehold(other);
    }
  });

  it("o Desfazer vale por 30 minutos", async () => {
    const { resgate } = await savingsWithResgates();
    const done = await applyCleanup(
      prisma,
      manager,
      editScope,
      { categoryId: resgate.id, expectedCount: 3, archive: false },
      TEST_CTX,
      "2026-11-04",
    );
    const later = new Date(Date.now() + 31 * 60_000);
    expect(
      await codeOf(undoCleanup(prisma, manager, editScope, done.cleanupId, TEST_CTX, later)),
    ).toBe("UNDO_EXPIRED");
  });

  it("um mercado com dois PIX de mesmo valor por acaso não aparece", async () => {
    const savings = await prisma.financialAccount.create({
      data: {
        householdId: h.householdId,
        walletId: h.holderWallet.id,
        holderId: h.holder.id,
        name: "Poupança",
        kind: "SAVINGS",
      },
    });
    const buy = (amount: string, accountId = h.checking.id) =>
      insertTransaction(h, {
        walletId: h.holderWallet.id,
        accountId,
        amount,
        occurredOn: "2026-10-10",
        description: "MERCADO",
        categoryId: cats.mercado.id,
      });
    await Promise.all([
      buy("-40.00"),
      buy("40.00", savings.id),
      ...["-10.00", "-11.00", "-12.00", "-13.00"].map((a) => buy(a)),
    ]);
    expect(await findCleanups(prisma, manager, editScope, "2026-11-04")).toEqual([]);
  });
});
