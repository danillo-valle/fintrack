// M13.2 contra o Postgres (adendos dos ADRs 011 e 012): a transferência entre contas e o
// pagamento da fatura na revisão, a transferência de um lado só, o "O que foi" com as parcelas,
// o Editar conta, o Editar categoria e as datas da fatura aberta.
//
// Rode com: pnpm test:integration
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  authorizeScope,
  authorizeTransaction,
  authorizeWallet,
  authorizeHousehold,
  DomainError,
  type WalletScope,
} from "../access";
import { updateAccount } from "../accounts";
import { updateCategory } from "../categories";
import {
  confirmBulk,
  confirmTransfer,
  markTransfer,
  rejectTransfer,
  reviewQueue,
  undoMatch,
  unmarkTransfer,
} from "../review";
import { openStatementTotals } from "../statements";
import { setTransactionCategory, setTransactionLabel } from "../transactions";
import {
  createTestCategories,
  createTestHousehold,
  dbError,
  deleteTestHousehold,
  prisma,
  TEST_CTX,
  type TestHousehold,
} from "./fixtures";

const day = (d: string) => new Date(`${d}T00:00:00Z`);

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
let other: TestHousehold;
let savings: { id: string };
let holder: WalletScope<"edit">;

beforeEach(async () => {
  [h, other] = await Promise.all([createTestHousehold(), createTestHousehold()]);
  savings = await prisma.financialAccount.create({
    data: {
      householdId: h.householdId,
      walletId: h.holderWallet.id,
      holderId: h.holder.id,
      name: "Poupança",
      kind: "SAVINGS",
    },
  });
  holder = await authorizeScope(prisma, h.holder.id, "edit");
});
afterEach(async () => {
  await Promise.all([deleteTestHousehold(h), deleteTestHousehold(other)]);
});

/** Um recebido do banco (PENDING, OPEN_FINANCE) numa conta, como a busca grava. */
function received(
  t: TestHousehold,
  data: {
    accountId: string;
    amount: string;
    occurredOn: string;
    description: string;
    walletId?: string;
    method?: "PIX" | "CREDIT" | "DEBIT" | "DEPOSIT";
    status?: "PENDING" | "CONFIRMED";
    installment?: [number, number];
    categoryId?: string | null;
  },
) {
  return prisma.transaction.create({
    data: {
      householdId: t.householdId,
      walletId: data.walletId ?? t.holderWallet.id,
      accountId: data.accountId,
      method: data.method ?? "PIX",
      amount: data.amount,
      occurredOn: day(data.occurredOn),
      description: data.description,
      categoryId: data.categoryId ?? null,
      categorizedBy: data.categoryId ? "MANUAL" : null,
      status: data.status ?? "PENDING",
      source: "OPEN_FINANCE",
      externalId: `ext-${randomUUID()}`,
      providerInstallmentNumber: data.installment?.[0] ?? null,
      providerInstallmentCount: data.installment?.[1] ?? null,
    },
  });
}

describe("transferência entre contas (M13.2)", () => {
  it("sugere, liga os dois lados sem categoria e fora do lote; o Desfazer devolve os dois", async () => {
    const out = await received(h, {
      accountId: h.checking.id,
      amount: "-500.00",
      occurredOn: "2026-10-09",
      description: "TRANSF ENVIADA POUPANCA",
    });
    const into = await received(h, {
      accountId: savings.id,
      amount: "500.00",
      occurredOn: "2026-10-09",
      description: "APLICACAO POUPANCA",
    });
    const view = await authorizeScope(prisma, h.holder.id, "view");
    const queue = await reviewQueue(prisma, view, holder);
    expect(queue.transfers).toHaveLength(1);
    expect(queue.transfers[0]).toMatchObject({
      billPayment: false,
      out: { id: out.id, account: { kind: "CHECKING" } },
      in: { id: into.id, account: { kind: "SAVINGS" } },
    });
    // Quem tem transferência sugerida não aparece nos grupos nem entra no lote
    expect(queue.groups.flatMap((g) => g.items).map((i) => i.id)).not.toContain(out.id);
    await prisma.transaction.update({ where: { id: out.id }, data: { categoryId: null } });
    expect((await confirmBulk(prisma, holder, {}, TEST_CTX)).ids).toEqual([]);

    const { matchId, billPayment } = await confirmTransfer(
      prisma,
      holder,
      { outId: out.id, inId: into.id },
      TEST_CTX,
    );
    expect(billPayment).toBe(false);
    const [a, b] = await Promise.all(
      [out.id, into.id].map((id) => prisma.transaction.findUniqueOrThrow({ where: { id } })),
    );
    expect(a?.transferId).not.toBeNull();
    expect(a?.transferId).toBe(b?.transferId);
    expect([a?.status, b?.status, a?.categoryId, b?.categoryId]).toEqual([
      "CONFIRMED",
      "CONFIRMED",
      null,
      null,
    ]);
    // Duas abas: o segundo clique não liga de novo
    expect(
      await codeOf(confirmTransfer(prisma, holder, { outId: out.id, inId: into.id }, TEST_CTX)),
    ).toBe("REVIEW_STALE");

    await undoMatch(prisma, holder, matchId, TEST_CTX);
    const back = await prisma.transaction.findMany({ where: { id: { in: [out.id, into.id] } } });
    expect(back.map((r) => [r.status, r.transferId])).toEqual([
      ["PENDING", null],
      ["PENDING", null],
    ]);
  });

  it("um lado já conferido pode ser o par; o Desfazer o devolve conferido", async () => {
    const out = await received(h, {
      accountId: h.checking.id,
      amount: "-80.00",
      occurredOn: "2026-10-09",
      description: "PIX ENVIADO",
      status: "CONFIRMED",
    });
    const into = await received(h, {
      accountId: savings.id,
      amount: "80.00",
      occurredOn: "2026-10-10",
      description: "PIX RECEBIDO",
    });
    const { matchId } = await confirmTransfer(
      prisma,
      holder,
      { outId: out.id, inId: into.id },
      TEST_CTX,
    );
    await undoMatch(prisma, holder, matchId, TEST_CTX);
    const outAfter = await prisma.transaction.findUniqueOrThrow({ where: { id: out.id } });
    const inAfter = await prisma.transaction.findUniqueOrThrow({ where: { id: into.id } });
    expect([outAfter.status, outAfter.transferId]).toEqual(["CONFIRMED", null]);
    expect([inAfter.status, inAfter.transferId]).toEqual(["PENDING", null]);
  });

  it("o pagamento da fatura: a entrada no cartão sai da fatura aberta", async () => {
    // A janela da fatura aberta (fecha dia 3): de 03/10 a hoje
    const today = "2026-10-20";
    await received(h, {
      accountId: h.card.id,
      amount: "-100.00",
      occurredOn: "2026-10-05",
      description: "PADARIA",
      method: "CREDIT",
    });
    const credit = await received(h, {
      accountId: h.card.id,
      amount: "1940.00",
      occurredOn: "2026-10-09",
      description: "PAGTO DEB AUTOMATICO",
      method: "CREDIT",
    });
    const debit = await received(h, {
      accountId: h.checking.id,
      amount: "-1940.00",
      occurredOn: "2026-10-09",
      description: "DEBITO AUT FATURA CARTAO",
    });
    const before = (await openStatementTotals(prisma, [h.card.id], today)).get(h.card.id);
    expect(before?.total).toBe(-184000n); // o crédito abatia: a fatura ficava negativa
    const { billPayment } = await confirmTransfer(
      prisma,
      holder,
      { outId: debit.id, inId: credit.id },
      TEST_CTX,
    );
    expect(billPayment).toBe(true);
    const after = (await openStatementTotals(prisma, [h.card.id], today)).get(h.card.id);
    expect(after).toEqual({ total: 10000n, closingDate: "2026-11-03", dueDate: "2026-11-09" });
  });

  it("recusada não volta; carteira que a pessoa não edita ou de outro lar: NOT_FOUND", async () => {
    const out = await received(h, {
      accountId: h.checking.id,
      amount: "-300.00",
      occurredOn: "2026-10-09",
      description: "TED",
    });
    const into = await received(h, {
      accountId: savings.id,
      amount: "300.00",
      occurredOn: "2026-10-09",
      description: "TED",
    });
    await rejectTransfer(prisma, holder, { outId: out.id, inId: into.id }, TEST_CTX);
    const view = await authorizeScope(prisma, h.holder.id, "view");
    expect((await reviewQueue(prisma, view, holder)).transfers).toEqual([]);

    // O vale da parceira (pessoal dela) e uma conta de outro lar
    const hers = await received(h, {
      accountId: h.voucher.id,
      walletId: h.partnerWallet.id,
      amount: "300.00",
      occurredOn: "2026-10-09",
      description: "RECARGA",
      method: "DEPOSIT",
    });
    const foreign = await received(other, {
      accountId: other.checking.id,
      amount: "300.00",
      occurredOn: "2026-10-09",
      description: "TED",
    });
    for (const id of [hers.id, foreign.id]) {
      expect(
        await codeOf(confirmTransfer(prisma, holder, { outId: out.id, inId: id }, TEST_CTX)),
      ).toBe("NOT_FOUND");
    }
    // Valores que não fecham: não é transferência
    const odd = await received(h, {
      accountId: savings.id,
      amount: "299.99",
      occurredOn: "2026-10-09",
      description: "TED",
    });
    expect(
      await codeOf(confirmTransfer(prisma, holder, { outId: out.id, inId: odd.id }, TEST_CTX)),
    ).toBe("TRANSFER_NOT_ALLOWED");
  });
});

describe("transferência de um lado só (M13.2)", () => {
  it("marca, entra no lote; escolher categoria ou desmarcar desfaz", async () => {
    const cats = await createTestCategories(h.householdId);
    const pix = await received(h, {
      accountId: h.checking.id,
      amount: "-800.00",
      occurredOn: "2026-10-10",
      description: "PIX ENVIADO PARCEIRA",
    });
    await markTransfer(prisma, holder, { transactionId: pix.id, peer: "HOUSEHOLD" }, TEST_CTX);
    let row = await prisma.transaction.findUniqueOrThrow({ where: { id: pix.id } });
    expect([row.transferPeer, row.status, row.transferId === null]).toEqual([
      "HOUSEHOLD",
      "PENDING",
      false,
    ]);

    // Escolher a categoria tira a marca
    const grant = await authorizeTransaction(prisma, h.holder.id, pix.id, "edit");
    if (!grant.ok) throw new Error("sem acesso");
    await setTransactionCategory(
      prisma,
      grant.grant,
      cats.mercado.id,
      { rememberRule: null },
      TEST_CTX,
    );
    row = await prisma.transaction.findUniqueOrThrow({ where: { id: pix.id } });
    expect([row.transferId, row.transferPeer, row.categoryId]).toEqual([
      null,
      null,
      cats.mercado.id,
    ]);

    // Marca de novo (para fora), desmarca, e marca para o lote
    await markTransfer(prisma, holder, { transactionId: pix.id, peer: "EXTERNAL" }, TEST_CTX);
    await unmarkTransfer(prisma, holder, pix.id, TEST_CTX);
    row = await prisma.transaction.findUniqueOrThrow({ where: { id: pix.id } });
    expect([row.transferId, row.transferPeer]).toEqual([null, null]);
    await markTransfer(prisma, holder, { transactionId: pix.id, peer: "EXTERNAL" }, TEST_CTX);
    expect((await confirmBulk(prisma, holder, {}, TEST_CTX)).ids).toContain(pix.id);
  });

  it("as regras do banco: o outro lado só com transferId", async () => {
    const pix = await received(h, {
      accountId: h.checking.id,
      amount: "-1.00",
      occurredOn: "2026-10-10",
      description: "PIX",
    });
    expect(
      await dbError(
        prisma.transaction.update({ where: { id: pix.id }, data: { transferPeer: "EXTERNAL" } }),
      ),
    ).toContain("transaction_transfer_peer_check");
    expect(
      await dbError(prisma.transaction.update({ where: { id: pix.id }, data: { label: "" } })),
    ).toContain("transaction_label_length_check");
  });
});

describe("O que foi (M13.2)", () => {
  it("vale para as parcelas irmãs; o texto do banco fica; a auditoria não leva o texto", async () => {
    const parcels = await Promise.all(
      ["01/03", "02/03", "03/03"].map((n, i) =>
        received(h, {
          accountId: h.card.id,
          amount: "-97.64",
          occurredOn: ["2026-08-05", "2026-09-05", "2026-10-05"][i] as string,
          description: `MERCADOLIVRE*MERCA${n}`,
          method: "CREDIT",
          installment: [i + 1, 3],
        }),
      ),
    );
    const other3 = await received(h, {
      accountId: h.card.id,
      amount: "-97.64",
      occurredOn: "2026-10-05",
      description: "OUTRA LOJA 03/03",
      method: "CREDIT",
      installment: [3, 3],
    });
    const grant = await authorizeTransaction(prisma, h.holder.id, parcels[2]!.id, "edit");
    if (!grant.ok) throw new Error("sem acesso");
    expect(await setTransactionLabel(prisma, grant.grant, "Sapato da Zara", TEST_CTX)).toBe(3);
    const ids = [...parcels.map((p) => p.id), other3.id];
    const found = await prisma.transaction.findMany({ where: { id: { in: ids } } });
    const rows = ids.map((id) => found.find((r) => r.id === id));
    expect(rows.map((r) => r?.label)).toEqual([
      "Sapato da Zara",
      "Sapato da Zara",
      "Sapato da Zara",
      null,
    ]);
    expect(rows[0]?.description).toBe("MERCADOLIVRE*MERCA01/03");
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { householdId: h.householdId, action: "transaction.labeled" },
    });
    expect(JSON.stringify(audit.metadata)).not.toMatch(/Zara/);

    // Igual ao texto do banco não se guarda; vazio limpa
    expect(
      await setTransactionLabel(prisma, grant.grant, " mercadolivre merca 03/03", TEST_CTX),
    ).toBe(3);
    expect(
      (await prisma.transaction.findUniqueOrThrow({ where: { id: parcels[0]!.id } })).label,
    ).toBe(" mercadolivre merca 03/03".trim());
    await setTransactionLabel(prisma, grant.grant, "", TEST_CTX);
    expect(
      (await prisma.transaction.findUniqueOrThrow({ where: { id: parcels[0]!.id } })).label,
    ).toBeNull();
  });

  it("num lançamento manual: LABEL_NOT_ALLOWED (a descrição já é da pessoa)", async () => {
    const manual = await prisma.transaction.create({
      data: {
        householdId: h.householdId,
        walletId: h.holderWallet.id,
        accountId: h.checking.id,
        method: "PIX",
        amount: "-10.00",
        occurredOn: day("2026-10-10"),
        description: "Padaria",
      },
    });
    const grant = await authorizeTransaction(prisma, h.holder.id, manual.id, "edit");
    if (!grant.ok) throw new Error("sem acesso");
    expect(await codeOf(setTransactionLabel(prisma, grant.grant, "Pão", TEST_CTX))).toBe(
      "LABEL_NOT_ALLOWED",
    );
  });
});

describe("Editar conta (M13.2)", () => {
  async function manage(userId: string, walletId: string) {
    const access = await authorizeWallet(prisma, userId, walletId, "manage_accounts");
    if (!access.ok) throw new Error(`esperava manage_accounts, veio ${access.reason}`);
    return access.grant;
  }

  it("apelido sempre; tipo só manual e entre corrente, poupança e dinheiro", async () => {
    const grant = await manage(h.holder.id, h.holderWallet.id);
    await updateAccount(
      prisma,
      grant,
      h.checking.id,
      { name: "Aurora · Conta corrente", kind: "SAVINGS" },
      TEST_CTX,
    );
    expect(
      await prisma.financialAccount.findUniqueOrThrow({ where: { id: h.checking.id } }),
    ).toMatchObject({ name: "Aurora · Conta corrente", kind: "SAVINGS" });
    expect(
      await codeOf(
        updateAccount(prisma, grant, h.checking.id, { name: "X", kind: "CREDIT_CARD" }, TEST_CTX),
      ),
    ).toBe("ACCOUNT_KIND_LOCKED");
    // Ligada ao banco: o tipo vem dele
    const connection = await prisma.providerConnection.create({
      data: { userId: h.holder.id, walletId: h.holderWallet.id, provider: "PLUGGY" },
    });
    await prisma.financialAccount.update({
      where: { id: savings.id },
      data: { connectionId: connection.id, externalId: "ext-poupanca" },
    });
    expect(
      await codeOf(
        updateAccount(prisma, grant, savings.id, { name: "P", kind: "CHECKING" }, TEST_CTX),
      ),
    ).toBe("ACCOUNT_KIND_LOCKED");
    // A conta de outra carteira (IDOR) e a de outro lar respondem como inexistentes
    for (const id of [h.voucher.id, other.checking.id]) {
      expect(
        await codeOf(updateAccount(prisma, grant, id, { name: "Y", kind: "CHECKING" }, TEST_CTX)),
      ).toBe("NOT_FOUND");
    }
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { householdId: h.householdId, action: "account.updated" },
    });
    expect(JSON.stringify(audit.metadata)).not.toMatch(/Aurora/);
  });
});

describe("Editar categoria (M13.2)", () => {
  it("nome único; o tipo só muda sem lançamento do outro sinal", async () => {
    const cats = await createTestCategories(h.householdId);
    const access = await authorizeHousehold(prisma, h.holder.id, "manage_categories");
    if (!access.ok) throw new Error("sem acesso");
    const grant = access.grant;
    expect(
      await codeOf(
        updateCategory(
          prisma,
          grant,
          cats.salario.id,
          { name: "Mercado", kind: "INCOME" },
          TEST_CTX,
        ),
      ),
    ).toBe("CATEGORY_EXISTS");
    // "Escola" criada como receita por engano, com uma entrada: não vira despesa
    const escola = await prisma.category.create({
      data: { householdId: h.householdId, name: "Escola", kind: "INCOME" },
    });
    const entrada = await received(h, {
      accountId: h.checking.id,
      amount: "50.00",
      occurredOn: "2026-10-10",
      description: "PIX",
      categoryId: escola.id,
    });
    expect(
      await codeOf(
        updateCategory(prisma, grant, escola.id, { name: "Escola", kind: "EXPENSE" }, TEST_CTX),
      ),
    ).toBe("CATEGORY_KIND_LOCKED");
    // Trocada a categoria da entrada, a Escola vira despesa
    await prisma.transaction.update({
      where: { id: entrada.id },
      data: { categoryId: cats.salario.id },
    });
    await updateCategory(prisma, grant, escola.id, { name: "Escola", kind: "EXPENSE" }, TEST_CTX);
    expect((await prisma.category.findUniqueOrThrow({ where: { id: escola.id } })).kind).toBe(
      "EXPENSE",
    );
    expect(
      await codeOf(
        updateCategory(prisma, grant, other.home.id, { name: "Z", kind: "EXPENSE" }, TEST_CTX),
      ),
    ).toBe("NOT_FOUND");
  });
});
