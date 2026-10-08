// Lançamentos contra o Postgres de verdade (M07): crachás, forma de pagamento × conta,
// transferência, exclusão com desfazer, lista com cursor, totais ao centavo, exportação e as
// regras novas do banco. Cada teste cria um lar próprio e o apaga no fim.
//
// Rode com: pnpm test:integration   (precisa do Postgres no ar: pnpm db:up)
import { randomUUID } from "node:crypto";
import {
  ACCOUNT_KINDS,
  allowedMethods,
  PAYMENT_METHODS,
  totalsOf,
  type PaymentMethod,
} from "@fintrack/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  authorizeAccountUse,
  authorizeScope,
  authorizeTransaction,
  authorizeWallet,
  DomainError,
  type TransactionGrant,
  type WalletGrant,
  type WalletScope,
} from "../access";
import {
  createTransaction,
  createTransfer,
  deleteTransaction,
  exportTransactions,
  listTransactions,
  restoreTransaction,
  sumTransactions,
  updateTransaction,
  type TransactionFilters,
} from "../transactions";
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

let h: TestHousehold;
let other: TestHousehold;
let cats: Awaited<ReturnType<typeof createTestCategories>>;
beforeEach(async () => {
  [h, other] = await Promise.all([createTestHousehold(), createTestHousehold()]);
  cats = await createTestCategories(h.householdId);
});
afterEach(async () => {
  await Promise.all([deleteTestHousehold(h), deleteTestHousehold(other)]);
});

const OCTOBER: TransactionFilters = { from: "2026-10-01", to: "2026-10-31" };

async function walletGrant<A extends "view" | "edit" | "export">(
  userId: string,
  walletId: string,
  action: A,
): Promise<WalletGrant<A>> {
  const access = await authorizeWallet(prisma, userId, walletId, action);
  if (!access.ok) throw new Error(`esperava ${action}, veio ${access.reason}`);
  return access.grant;
}
async function accountGrant(userId: string, accountId: string) {
  const access = await authorizeAccountUse(prisma, userId, accountId);
  if (!access.ok) throw new Error(`esperava usar a conta, veio ${access.reason}`);
  return access.grant;
}
async function txGrant<A extends "view" | "edit">(
  userId: string,
  id: string,
  action: A,
  includeDeleted = false,
): Promise<TransactionGrant<A>> {
  const access = await authorizeTransaction(prisma, userId, id, action, { includeDeleted });
  if (!access.ok) throw new Error(`esperava ${action}, veio ${access.reason}`);
  return access.grant;
}
const viewScope = (userId: string) => authorizeScope(prisma, userId, "view");

/** Lança uma despesa na Casa pela conta corrente da titular (o caminho mais comum). */
async function spend(description: string, cents: bigint, extra: Record<string, unknown> = {}) {
  return createTransaction(
    prisma,
    await walletGrant(h.holder.id, h.home.id, "edit"),
    await accountGrant(h.holder.id, h.checking.id),
    { kind: "expense", cents, description, occurredOn: "2026-10-07", categoryId: null, ...extra },
    { scope: await viewScope(h.holder.id) },
    TEST_CTX,
  );
}

// ── Regras novas do banco ───────────────────────────────────────────────────────

describe("regras do banco do M07 (CHECKs da migração)", () => {
  it("transaction_categorized_by_check: 'quem categorizou' sem categoria", async () => {
    const t = await insertTransaction(h, {
      amount: "-10",
      occurredOn: "2026-10-01",
      description: "x",
    });
    const error = await dbError(
      prisma.transaction.update({ where: { id: t.id }, data: { categorizedBy: "RULE" } }),
    );
    expect(error).toContain("transaction_categorized_by_check");
  });

  it("transaction_transfer_category_check: transferência com categoria", async () => {
    const error = await dbError(
      insertTransaction(h, {
        amount: "-10",
        occurredOn: "2026-10-01",
        description: "x",
        method: "TRANSFER",
        transferId: randomUUID(),
        categoryId: cats.mercado.id,
      }),
    );
    expect(error).toContain("transaction_transfer_category_check");
  });

  const example = (over: Record<string, unknown>) =>
    prisma.categorizationExample.create({
      data: {
        householdId: h.householdId,
        description: "Mercado",
        isExpense: true,
        toCategoryId: cats.mercado.id,
        ...over,
      },
    });

  it("categorization_example_description_check: descrição vazia ou longa demais", async () => {
    expect(await dbError(example({ description: "" }))).toContain(
      "categorization_example_description_check",
    );
    expect(await dbError(example({ description: "x".repeat(201) }))).toContain(
      "categorization_example_description_check",
    );
  });

  it("categorization_example_change_check: 'corrigir' para a mesma categoria", async () => {
    expect(await dbError(example({ fromCategoryId: cats.mercado.id }))).toContain(
      "categorization_example_change_check",
    );
  });

  it("categorization_example_source_check: quem decidiu sem categoria anterior", async () => {
    expect(await dbError(example({ fromSource: "RULE" }))).toContain(
      "categorization_example_source_check",
    );
  });

  it("o exemplo só aponta para categoria do mesmo lar (chave composta)", async () => {
    const foreign = await prisma.category.create({
      data: { householdId: other.householdId, name: "De fora", kind: "EXPENSE" },
    });
    expect(await dbError(example({ toCategoryId: foreign.id }))).toContain(
      "categorization_example_toCategoryId_householdId_fkey",
    );
  });
});

describe("forma de pagamento × conta: a regra do core é a mesma do gatilho do banco", () => {
  // 5 tipos de conta × 9 formas = 45 combinações, cada uma contra o gatilho de verdade
  const cases = ACCOUNT_KINDS.flatMap((kind) =>
    PAYMENT_METHODS.map((method) => ({ kind, method })),
  );

  it.each(cases)("$kind · $method", async ({ kind, method }) => {
    const account = await prisma.financialAccount.create({
      data: {
        householdId: h.householdId,
        walletId: h.home.id,
        name: `Conta ${kind}`,
        kind,
        ...(kind === "CREDIT_CARD" ? { closingDay: 3, dueDay: 10 } : {}),
      },
    });
    const insert = prisma.transaction.create({
      data: {
        householdId: h.householdId,
        walletId: h.home.id,
        accountId: account.id,
        method: method as PaymentMethod,
        amount: "-1.00",
        occurredOn: new Date("2026-10-01T00:00:00Z"),
        description: "contrato",
      },
    });
    if (allowedMethods(kind).includes(method)) {
      await expect(insert).resolves.toBeTruthy();
    } else {
      expect(await dbError(insert)).toContain("transaction_method_matches_account");
    }
  });
});

// ── Lançar ──────────────────────────────────────────────────────────────────────

describe("lançar", () => {
  it("despesa grava negativa, com forma padrão da conta, quem lançou e sem categoria", async () => {
    const { id } = await spend("Feira", 4235n);
    const row = await prisma.transaction.findUniqueOrThrow({ where: { id } });
    expect(row.amount.toString()).toBe("-42.35");
    expect(row.method).toBe("PIX");
    expect(row.createdById).toBe(h.holder.id);
    expect(row.categorizedBy).toBeNull();
    expect(row.occurredOn.toISOString()).toBe("2026-10-07T00:00:00.000Z");
  });

  it("forma que a conta não aceita: METHOD_NOT_ALLOWED (antes do banco)", async () => {
    const error = await spend("Crédito na corrente", 100n, { method: "CREDIT" }).catch((e) => e);
    expect((error as DomainError).code).toBe("METHOD_NOT_ALLOWED");
  });

  it("cartão de outra conta: CARD_NOT_ALLOWED", async () => {
    const error = await spend("Cartão errado", 100n, { cardId: h.holderCard.id }).catch((e) => e);
    expect((error as DomainError).code).toBe("CARD_NOT_ALLOWED");
  });

  it("categoria de despesa numa receita, de outro lar ou arquivada: CATEGORY_INVALID", async () => {
    const foreign = await prisma.category.create({
      data: { householdId: other.householdId, name: "Fora", kind: "EXPENSE" },
    });
    for (const categoryId of [cats.salario.id, foreign.id]) {
      const error = await spend("Errado", 100n, { categoryId }).catch((e) => e);
      expect((error as DomainError).code).toBe("CATEGORY_INVALID");
    }
    await prisma.category.update({
      where: { id: cats.mercado.id },
      data: { archivedAt: new Date() },
    });
    const error = await spend("Arquivada", 100n, { categoryId: cats.mercado.id }).catch((e) => e);
    expect((error as DomainError).code).toBe("CATEGORY_INVALID");
  });

  it("leitor da carteira não lança (ROLE); quem é de outro lar nem acha a carteira", async () => {
    await prisma.walletMember.update({
      where: { walletId_userId: { walletId: h.home.id, userId: h.partner.id } },
      data: { role: "VIEWER" },
    });
    expect(await authorizeWallet(prisma, h.partner.id, h.home.id, "edit")).toEqual({
      ok: false,
      reason: "ROLE",
    });
    expect(await authorizeWallet(prisma, other.holder.id, h.home.id, "edit")).toEqual({
      ok: false,
      reason: "NOT_FOUND",
    });
  });
});

describe("conta: as duas portas (carteira e cartão adicional)", () => {
  it("a parceira não usa a conta corrente da titular: NOT_FOUND", async () => {
    expect(await authorizeAccountUse(prisma, h.partner.id, h.checking.id)).toEqual({
      ok: false,
      reason: "NOT_FOUND",
    });
  });

  it("portadora do adicional lança na fatura da titular, só com o cartão dela", async () => {
    const grant = await accountGrant(h.partner.id, h.card.id);
    expect(grant.via).toBe("CARD");
    expect(grant.cardIds).toEqual([h.additionalCard.id]);

    const { id } = await createTransaction(
      prisma,
      await walletGrant(h.partner.id, h.home.id, "edit"),
      grant,
      {
        kind: "expense",
        cents: 9990n,
        description: "Farmácia",
        occurredOn: "2026-10-07",
        categoryId: null,
      },
      { scope: await viewScope(h.partner.id) },
      TEST_CTX,
    );
    const row = await prisma.transaction.findUniqueOrThrow({ where: { id } });
    expect(row.cardId).toBe(h.additionalCard.id); // sem escolher, vai o cartão dela
    expect(row.method).toBe("CREDIT");

    // Com o cartão da titular: recusado
    const error = await createTransaction(
      prisma,
      await walletGrant(h.partner.id, h.home.id, "edit"),
      grant,
      {
        kind: "expense",
        cents: 100n,
        description: "Cartão da outra",
        occurredOn: "2026-10-07",
        categoryId: null,
        cardId: h.holderCard.id,
      },
      { scope: await viewScope(h.partner.id) },
      TEST_CTX,
    ).catch((e) => e);
    expect((error as DomainError).code).toBe("CARD_NOT_ALLOWED");
  });

  it("conta arquivada: ARCHIVED; conta de outro lar ou id inventado: NOT_FOUND", async () => {
    await prisma.financialAccount.update({
      where: { id: h.checking.id },
      data: { archivedAt: new Date() },
    });
    expect(await authorizeAccountUse(prisma, h.holder.id, h.checking.id)).toEqual({
      ok: false,
      reason: "ARCHIVED",
    });
    for (const id of [other.checking.id, randomUUID(), "nao-e-uuid"]) {
      expect(await authorizeAccountUse(prisma, h.holder.id, id)).toEqual({
        ok: false,
        reason: "NOT_FOUND",
      });
    }
  });
});

// ── IDOR no lançamento ─────────────────────────────────────────────────────────

describe("IDOR: lançamento de outra pessoa responde NOT_FOUND", () => {
  it("outro lar, carteira pessoal alheia, id inventado e id fora do formato: a mesma resposta", async () => {
    const mine = await insertTransaction(h, {
      walletId: h.holderWallet.id,
      amount: "-10",
      occurredOn: "2026-10-01",
      description: "Pessoal da titular",
    });
    const notFound = { ok: false, reason: "NOT_FOUND" };
    expect(await authorizeTransaction(prisma, other.holder.id, mine.id, "view")).toEqual(notFound);
    expect(await authorizeTransaction(prisma, h.partner.id, mine.id, "view")).toEqual(notFound);
    expect(await authorizeTransaction(prisma, h.holder.id, randomUUID(), "view")).toEqual(notFound);
    expect(await authorizeTransaction(prisma, h.holder.id, "1 OR 1=1", "view")).toEqual(notFound);
    expect((await authorizeTransaction(prisma, h.holder.id, mine.id, "view")).ok).toBe(true);
  });

  it("excluído só aparece para o 'desfazer' (includeDeleted)", async () => {
    const t = await insertTransaction(h, {
      amount: "-10",
      occurredOn: "2026-10-01",
      description: "x",
      deletedAt: new Date(),
    });
    expect((await authorizeTransaction(prisma, h.holder.id, t.id, "edit")).ok).toBe(false);
    expect(
      (await authorizeTransaction(prisma, h.holder.id, t.id, "edit", { includeDeleted: true })).ok,
    ).toBe(true);
  });

  it("leitor vê, mas não edita (ROLE)", async () => {
    const t = await insertTransaction(h, {
      amount: "-10",
      occurredOn: "2026-10-01",
      description: "x",
    });
    await prisma.walletMember.update({
      where: { walletId_userId: { walletId: h.home.id, userId: h.partner.id } },
      data: { role: "VIEWER" },
    });
    expect((await authorizeTransaction(prisma, h.partner.id, t.id, "view")).ok).toBe(true);
    expect(await authorizeTransaction(prisma, h.partner.id, t.id, "edit")).toEqual({
      ok: false,
      reason: "ROLE",
    });
  });
});

// ── Editar, excluir, desfazer ──────────────────────────────────────────────────

describe("editar", () => {
  it("muda valor, data, carteira e conta; mover para carteira sem 'edit' é impossível", async () => {
    const { id } = await spend("Almoço", 3500n);
    await updateTransaction(
      prisma,
      await txGrant(h.holder.id, id, "edit"),
      await walletGrant(h.holder.id, h.holderWallet.id, "edit"),
      await accountGrant(h.holder.id, h.checking.id),
      {
        kind: "expense",
        cents: 4000n,
        description: "Almoço",
        occurredOn: "2026-10-08",
        categoryId: null,
      },
      { scope: await viewScope(h.holder.id) },
      TEST_CTX,
    );
    const row = await prisma.transaction.findUniqueOrThrow({ where: { id } });
    expect([row.walletId, row.amount.toString()]).toEqual([h.holderWallet.id, "-40"]);
    // A parceira não tem crachá de "edit" na pessoal da titular: nem chega a chamar a operação
    expect((await authorizeWallet(prisma, h.partner.id, h.holderWallet.id, "edit")).ok).toBe(false);
  });

  it("transferência não se edita: TRANSFER_READONLY", async () => {
    const { transferId } = await createTransfer(
      prisma,
      await accountGrant(h.holder.id, h.checking.id),
      await accountGrant(h.holder.id, h.card.id),
      { cents: 50000n, occurredOn: "2026-10-09", description: "Pagamento da fatura" },
    );
    const leg = await prisma.transaction.findFirstOrThrow({ where: { transferId } });
    const error = await updateTransaction(
      prisma,
      await txGrant(h.holder.id, leg.id, "edit"),
      await walletGrant(h.holder.id, h.holderWallet.id, "edit"),
      await accountGrant(h.holder.id, h.checking.id),
      { kind: "expense", cents: 1n, description: "x", occurredOn: "2026-10-09", categoryId: null },
      { scope: await viewScope(h.holder.id) },
      TEST_CTX,
    ).catch((e) => e);
    expect((error as DomainError).code).toBe("TRANSFER_READONLY");
  });
});

describe("excluir com desfazer (exclusão lógica)", () => {
  it("some da lista e dos totais; desfazer devolve; os dois ficam na auditoria", async () => {
    const { id } = await spend("Cinema", 6000n);
    const scope = await viewScope(h.holder.id);
    await deleteTransaction(prisma, await txGrant(h.holder.id, id, "edit"), TEST_CTX);
    expect((await listTransactions(prisma, scope, OCTOBER)).items).toHaveLength(0);
    expect((await sumTransactions(prisma, scope, OCTOBER)).expense).toBe(0n);
    expect(await prisma.transaction.count({ where: { id } })).toBe(1); // continua no banco

    await restoreTransaction(prisma, await txGrant(h.holder.id, id, "edit", true), TEST_CTX);
    expect((await sumTransactions(prisma, scope, OCTOBER)).expense).toBe(-6000n);
    expect(await auditActions(h.householdId)).toEqual([
      "transaction.deleted",
      "transaction.restored",
    ]);
  });

  it("transferência: excluir um lado apaga os dois", async () => {
    const { transferId } = await createTransfer(
      prisma,
      await accountGrant(h.holder.id, h.checking.id),
      await accountGrant(h.holder.id, h.card.id),
      { cents: 50000n, occurredOn: "2026-10-09", description: "Pagamento da fatura" },
    );
    const leg = await prisma.transaction.findFirstOrThrow({ where: { transferId } });
    await deleteTransaction(prisma, await txGrant(h.holder.id, leg.id, "edit"), TEST_CTX);
    expect(await prisma.transaction.count({ where: { transferId, deletedAt: null } })).toBe(0);
  });
});

// ── Transferência ───────────────────────────────────────────────────────────────

describe("transferência e pagamento da fatura", () => {
  it("dois lados, cada um na carteira da própria conta, somando zero", async () => {
    const { transferId } = await createTransfer(
      prisma,
      await accountGrant(h.holder.id, h.checking.id),
      await accountGrant(h.holder.id, h.card.id),
      { cents: 50000n, occurredOn: "2026-10-09", description: "Pagamento da fatura" },
    );
    const legs = await prisma.transaction.findMany({
      where: { transferId },
      orderBy: { amount: "asc" },
    });
    expect(legs.map((l) => [l.accountId, l.amount.toString(), l.method])).toEqual([
      [h.checking.id, "-500", "TRANSFER"],
      [h.card.id, "500", "TRANSFER"],
    ]);
  });

  it("portadora do adicional não move dinheiro da conta da titular", async () => {
    const error = await createTransfer(
      prisma,
      await accountGrant(h.partner.id, h.card.id), // porta do cartão
      await accountGrant(h.partner.id, h.voucher.id),
      { cents: 100n, occurredOn: "2026-10-09", description: "x" },
    ).catch((e) => e);
    expect((error as DomainError).code).toBe("NOT_FOUND");
  });

  it("mesma conta nos dois lados: SAME_ACCOUNT; crédito como forma: METHOD_NOT_ALLOWED", async () => {
    const checking = await accountGrant(h.holder.id, h.checking.id);
    const card = await accountGrant(h.holder.id, h.card.id);
    const input = { cents: 1n, occurredOn: "2026-10-09", description: "x" };
    expect(
      ((await createTransfer(prisma, checking, checking, input).catch((e) => e)) as DomainError)
        .code,
    ).toBe("SAME_ACCOUNT");
    expect(
      (
        (await createTransfer(prisma, checking, card, { ...input, method: "CREDIT" }).catch(
          (e) => e,
        )) as DomainError
      ).code,
    ).toBe("METHOD_NOT_ALLOWED");
  });
});

// ── Lista, cursor e totais ──────────────────────────────────────────────────────

describe("lista com cursor e totais ao centavo", () => {
  async function seedMonth() {
    // 9 lançamentos: 4 no mesmo dia (o desempate é o id), uma transferência e um de setembro
    const rows = [
      ["-12.34", "2026-10-07", "Padaria"],
      ["-0.01", "2026-10-07", "Centavo"],
      ["-99.99", "2026-10-07", "Mercado Dia"],
      ["8500.00", "2026-10-07", "Salário"],
      ["-45.50", "2026-10-05", "Restaurante"],
      ["-7.25", "2026-10-02", "Café"],
      ["-300.00", "2026-09-30", "Setembro"],
    ] as const;
    for (const [amount, occurredOn, description] of rows) {
      await insertTransaction(h, { amount, occurredOn, description });
    }
    const transferId = randomUUID();
    await insertTransaction(h, {
      amount: "-200",
      occurredOn: "2026-10-03",
      description: "Guardar",
      method: "TRANSFER",
      transferId,
    });
    await insertTransaction(h, {
      amount: "200",
      occurredOn: "2026-10-03",
      description: "Guardar",
      method: "TRANSFER",
      transferId,
      accountId: h.voucher.id,
    });
  }

  it("percorrer as páginas dá a lista inteira, em ordem, sem repetir nem pular", async () => {
    await seedMonth();
    const scope = await viewScope(h.holder.id);
    const all = (await listTransactions(prisma, scope, OCTOBER, null, 100)).items;
    expect(all).toHaveLength(8);

    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const page: Awaited<ReturnType<typeof listTransactions>> = await listTransactions(
        prisma,
        scope,
        OCTOBER,
        cursor,
        3,
      );
      seen.push(...page.items.map((i) => i.id));
      cursor = page.nextCursor;
    } while (cursor);
    expect(seen).toEqual(all.map((i) => i.id));
    expect(all.map((i) => i.occurredOn)).toEqual(
      [...all.map((i) => i.occurredOn)].sort().reverse(),
    );
  });

  it("lançamento novo no meio da leitura não duplica a página seguinte", async () => {
    await seedMonth();
    const scope = await viewScope(h.holder.id);
    const first = await listTransactions(prisma, scope, OCTOBER, null, 3);
    await insertTransaction(h, {
      amount: "-1",
      occurredOn: "2026-10-08",
      description: "Novo no topo",
    });
    const second = await listTransactions(prisma, scope, OCTOBER, first.nextCursor, 3);
    const ids = [...first.items, ...second.items].map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("os totais do banco batem com a soma da lista, ao centavo (transferência fora)", async () => {
    await seedMonth();
    const scope = await viewScope(h.holder.id);
    const items = (await listTransactions(prisma, scope, OCTOBER, null, 100)).items;
    const totals = await sumTransactions(prisma, scope, OCTOBER);
    expect(totals).toEqual(
      totalsOf(items.map((i) => ({ amount: i.amount, transferId: i.transferId }))),
    );
    expect(totals).toEqual({ income: 850000n, expense: -16509n, net: 833491n, count: 8 });
  });

  it("filtros: texto sem maiúscula, tipo, conta e 'sem categoria'", async () => {
    await seedMonth();
    const scope = await viewScope(h.holder.id);
    const count = async (f: Partial<TransactionFilters>) =>
      (await sumTransactions(prisma, scope, { ...OCTOBER, ...f })).count;
    expect(await count({ text: "PADARIA" })).toBe(1);
    expect(await count({ type: "transfer" })).toBe(2);
    expect(await count({ type: "income" })).toBe(1);
    expect(await count({ type: "expense" })).toBe(5);
    expect(await count({ categoryId: "none" })).toBe(6); // transferência não é "sem categoria"
    expect(await count({ accountId: h.card.id })).toBe(0);
  });

  it("a lista de quem não participa da Casa não mostra nada da Casa", async () => {
    await seedMonth();
    const scope = await viewScope(other.holder.id);
    expect((await listTransactions(prisma, scope, OCTOBER)).items).toHaveLength(0);
    // E pedir a carteira da Casa pelo filtro não abre a porta: o escopo vem vazio
    const forced = await authorizeScope(prisma, other.holder.id, "view", h.home.id);
    expect(forced.walletIds).toEqual([]);
  });
});

// ── Exportação ─────────────────────────────────────────────────────────────────

describe("exportação CSV", () => {
  it("só o dono exporta; o CSV abre no Excel e a exportação vai para a auditoria", async () => {
    await insertTransaction(h, {
      amount: "-12.34",
      occurredOn: "2026-10-07",
      description: '=HYPERLINK("x")',
    });
    await insertTransaction(h, {
      amount: "8500",
      occurredOn: "2026-10-07",
      description: "Salário",
    });
    const { csv, rows } = await exportTransactions(
      prisma,
      await walletGrant(h.holder.id, h.home.id, "export"),
      OCTOBER,
      TEST_CTX,
    );
    expect(rows).toBe(2);
    expect(csv.startsWith("﻿Data;Descrição;Valor;Tipo")).toBe(true);
    // A descrição que viraria fórmula ganha o apóstrofo (e as aspas dobradas do CSV)
    expect(csv).toContain(`;"'=HYPERLINK(""x"")";`);
    expect(csv).toContain(";-12,34;Despesa;");
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { householdId: h.householdId, action: "transactions.exported" },
    });
    expect(audit.metadata).toEqual({ from: "2026-10-01", to: "2026-10-31", rows: 2, filters: [] });
    expect(JSON.stringify(audit.metadata)).not.toContain("Salário"); // nada do conteúdo
  });

  it("editor e leitor não exportam (ROLE)", async () => {
    await prisma.walletMember.update({
      where: { walletId_userId: { walletId: h.home.id, userId: h.partner.id } },
      data: { role: "EDITOR" },
    });
    expect(await authorizeWallet(prisma, h.partner.id, h.home.id, "export")).toEqual({
      ok: false,
      reason: "ROLE",
    });
  });
});

// ── Conferência em tempo de compilação ─────────────────────────────────────────
// Nunca roda: o `pnpm typecheck` prova que cada operação exige o crachá certo.
export async function _compileTimeChecks(
  viewTx: TransactionGrant<"view">,
  editWallet: WalletGrant<"edit">,
  scope: WalletScope<"edit">,
) {
  // @ts-expect-error crachá de "view" não exclui lançamento
  await deleteTransaction(prisma, viewTx, TEST_CTX);
  // @ts-expect-error crachá de "edit" não exporta (export é só do dono)
  await exportTransactions(prisma, editWallet, OCTOBER, TEST_CTX);
  // @ts-expect-error uma lista de ids solta não é escopo
  await listTransactions(prisma, { walletIds: [h.home.id] }, OCTOBER);
  // Escopo de "edit" serve onde se pede "view"? Não: o crachá diz a ação exata
  // @ts-expect-error escopo de "edit" não é escopo de "view"
  await sumTransactions(prisma, scope, OCTOBER);
}
