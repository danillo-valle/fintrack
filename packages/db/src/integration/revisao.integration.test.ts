// Revisão e reconciliação (M09.2): a fila dos recebidos, o par (o mesmo gasto e a parcela), o
// estorno, a recusa, a confirmação em lote, o desfazer, o adicional que chega antes do
// cadastro e as regras novas do banco. Dados sintéticos; a sincronização usa a Pluggy DE
// MENTIRA (nenhum teste chama a Pluggy de verdade).
import { randomBytes, randomUUID } from "node:crypto";
import { PluggyProvider } from "@fintrack/importers";
import {
  createFakePluggy,
  SYNTHETIC_CREDENTIALS,
  SYNTHETIC_IDS,
  syntheticBank,
} from "@fintrack/importers/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  authorizeConnectionOwner,
  authorizeScope,
  authorizeWallet,
  confirmBulk,
  confirmPair,
  confirmReceived,
  createCard,
  DomainError,
  fromDbDecimal,
  linkAccounts,
  linkRefund,
  parseKeyring,
  providerForConnection,
  rejectPair,
  reviewQueue,
  runSync,
  saveCredentials,
  undoMatch,
  undoReview,
  type ConnectionGrant,
  type WalletScope,
} from "../index";
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
const editScope = (userId: string) => authorizeScope(prisma, userId, "edit");
const viewScope = (userId: string) => authorizeScope(prisma, userId, "view");

async function codeOf(promise: Promise<unknown>): Promise<string> {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  if (!(error instanceof DomainError))
    throw new Error(`esperava DomainError, veio ${String(error)}`);
  return error.code;
}

/** Um recebido do banco (PENDING, OPEN_FINANCE), como a sincronização grava. */
function received(
  h: TestHousehold,
  data: {
    amount: string;
    occurredOn: string;
    description: string;
    walletId?: string;
    categoryId?: string | null;
    installment?: [number, number];
    cardId?: string | null;
  },
) {
  return prisma.transaction.create({
    data: {
      householdId: h.householdId,
      walletId: data.walletId ?? h.holderWallet.id,
      accountId: h.card.id,
      cardId: data.cardId === undefined ? h.holderCard.id : data.cardId,
      method: "CREDIT",
      amount: data.amount,
      occurredOn: day(data.occurredOn),
      description: data.description,
      categoryId: data.categoryId ?? null,
      categorizedBy: data.categoryId ? "RULE" : null,
      status: "PENDING",
      source: "OPEN_FINANCE",
      externalId: `ext-${randomUUID()}`,
      providerCardLastFour: "1111",
      providerInstallmentNumber: data.installment?.[0] ?? null,
      providerInstallmentCount: data.installment?.[1] ?? null,
    },
  });
}

/** Um lançamento seu (manual, conferido) no cartão. */
function mine(
  h: TestHousehold,
  data: {
    amount: string;
    occurredOn: string;
    description: string;
    walletId?: string;
    categoryId?: string | null;
    status?: "CONFIRMED" | "SCHEDULED";
    installment?: { groupId: string; number: number };
    notes?: string;
  },
) {
  return prisma.transaction.create({
    data: {
      householdId: h.householdId,
      walletId: data.walletId ?? h.home.id,
      accountId: h.card.id,
      cardId: h.holderCard.id,
      method: "CREDIT",
      amount: data.amount,
      occurredOn: day(data.occurredOn),
      description: data.description,
      categoryId: data.categoryId ?? null,
      categorizedBy: data.categoryId ? "MANUAL" : null,
      status: data.status ?? "CONFIRMED",
      notes: data.notes ?? null,
      installmentGroupId: data.installment?.groupId ?? null,
      installmentNumber: data.installment?.number ?? null,
      createdById: h.holder.id,
    },
  });
}

describe("regras novas do banco (M09.2)", () => {
  let h: TestHousehold;
  beforeAll(async () => {
    h = await createTestHousehold();
  });
  afterAll(async () => {
    await deleteTestHousehold(h);
  });

  it("final do cartão: só 4 dígitos", async () => {
    const base = await received(h, { amount: "-1.00", occurredOn: "2026-10-01", description: "X" });
    for (const bad of ["12a4", "123"]) {
      expect(
        await dbError(
          prisma.transaction.update({
            where: { id: base.id },
            data: { providerCardLastFour: bad },
          }),
        ),
      ).toContain("transaction_provider_card_last_four_check");
    }
  });

  it("quem revisou só com quando; juntado só apagado e nunca a si mesmo", async () => {
    const row = await received(h, { amount: "-2.00", occurredOn: "2026-10-01", description: "Y" });
    expect(
      await dbError(
        prisma.transaction.update({ where: { id: row.id }, data: { reviewedById: h.holder.id } }),
      ),
    ).toContain("transaction_reviewed_check");
    const other = await mine(h, { amount: "-2.00", occurredOn: "2026-10-01", description: "Z" });
    expect(
      await dbError(
        prisma.transaction.update({ where: { id: other.id }, data: { mergedIntoId: row.id } }),
      ),
    ).toContain("transaction_merged_check");
    expect(
      await dbError(
        prisma.transaction.update({
          where: { id: other.id },
          data: { mergedIntoId: other.id, deletedAt: new Date() },
        }),
      ),
    ).toContain("transaction_merged_check");
  });

  it("par: dois lançamentos diferentes; desfeito anda com undoneAt", async () => {
    const a = await received(h, { amount: "-3.00", occurredOn: "2026-10-01", description: "A" });
    const b = await mine(h, { amount: "-3.00", occurredOn: "2026-10-01", description: "B" });
    const match = (data: Record<string, unknown>) =>
      prisma.transactionMatch.create({
        data: {
          householdId: h.householdId,
          receivedId: a.id,
          ownId: b.id,
          kind: "SAME",
          status: "CONFIRMED",
          ...data,
        },
      });
    expect(await dbError(match({ ownId: a.id }))).toContain("transaction_match_sides_check");
    expect(await dbError(match({ status: "UNDONE" }))).toContain("transaction_match_undone_check");
    expect(await dbError(match({ undoneAt: new Date() }))).toContain(
      "transaction_match_undone_check",
    );
  });
});

describe("revisão: pares, estorno, lote e desfazer", () => {
  let h: TestHousehold;
  let cats: Awaited<ReturnType<typeof createTestCategories>>;
  let holder: WalletScope<"edit">;

  beforeAll(async () => {
    h = await createTestHousehold();
    cats = await createTestCategories(h.householdId);
    holder = await editScope(h.holder.id);
  });
  afterAll(async () => {
    await deleteTestHousehold(h);
  });

  it("a fila sugere o par (mesmo valor, 1 dia) e fica UM lançamento com o seu lado", async () => {
    const own = await mine(h, {
      amount: "-312.48",
      occurredOn: "2026-10-12",
      description: "Mercado da esquina",
      categoryId: cats.mercado.id,
      notes: "com a parceira",
    });
    const bank = await received(h, {
      amount: "-312.48",
      occurredOn: "2026-10-13",
      description: "MERCADO BOM PRECO",
      categoryId: cats.padaria.id,
    });
    const queue = await reviewQueue(prisma, await viewScope(h.holder.id), holder);
    const pair = queue.pairs.find((p) => p.received.id === bank.id);
    expect(pair).toMatchObject({ kind: "SAME", daysApart: 1, own: { id: own.id } });
    // Quem tem par sugerido não aparece nos grupos (nem entra no lote)
    expect(queue.groups.flatMap((g) => g.items).some((i) => i.id === bank.id)).toBe(false);

    const { matchId } = await confirmPair(
      prisma,
      holder,
      { receivedId: bank.id, ownId: own.id },
      TEST_CTX,
    );
    const after = await prisma.transaction.findUniqueOrThrow({ where: { id: bank.id } });
    expect(after).toMatchObject({
      status: "CONFIRMED",
      // M13.2: o texto do banco fica; a sua descrição vira o "O que foi"
      description: "MERCADO BOM PRECO",
      label: "Mercado da esquina",
      categoryId: cats.mercado.id,
      categorizedBy: "MANUAL",
      walletId: h.home.id,
      notes: "com a parceira",
      reviewedById: h.holder.id,
      occurredOn: day("2026-10-13"), // a data do banco
    });
    expect(fromDbDecimal(after.amount)).toBe(-31248n);
    const gone = await prisma.transaction.findUniqueOrThrow({ where: { id: own.id } });
    expect(gone.deletedAt).not.toBeNull();
    expect(gone.mergedIntoId).toBe(bank.id);

    // Duas abas: o segundo clique não junta de novo
    expect(
      await codeOf(confirmPair(prisma, holder, { receivedId: bank.id, ownId: own.id }, TEST_CTX)),
    ).toBe("REVIEW_STALE");

    // Desfazer: os dois voltam como estavam
    await undoMatch(prisma, holder, matchId, TEST_CTX);
    const back = await prisma.transaction.findUniqueOrThrow({ where: { id: bank.id } });
    expect(back).toMatchObject({
      status: "PENDING",
      description: "MERCADO BOM PRECO",
      label: null,
      categoryId: cats.padaria.id,
      categorizedBy: "RULE",
      walletId: h.holderWallet.id,
      reviewedAt: null,
    });
    const restored = await prisma.transaction.findUniqueOrThrow({ where: { id: own.id } });
    expect(restored).toMatchObject({ deletedAt: null, mergedIntoId: null });
    expect(await codeOf(undoMatch(prisma, holder, matchId, TEST_CTX))).toBe("UNDO_EXPIRED");
  });

  it("parcela: o 3 de 6 do banco junta com a sua parcela 3 de 6, sem olhar a data", async () => {
    const group = await prisma.installmentGroup.create({
      data: {
        householdId: h.householdId,
        walletId: h.home.id,
        accountId: h.card.id,
        description: "Livros",
        totalAmount: "-899.40",
        installmentCount: 6,
        purchasedOn: day("2026-08-05"),
      },
    });
    const parcel = await mine(h, {
      amount: "-149.90",
      occurredOn: "2026-08-05",
      description: "Livros (parcela 3/6)",
      status: "SCHEDULED",
      installment: { groupId: group.id, number: 3 },
    });
    const bank = await received(h, {
      amount: "-149.90",
      occurredOn: "2026-10-05",
      description: "LIVRARIA NOBRE PARC 03/06",
      installment: [3, 6],
    });
    const queue = await reviewQueue(prisma, await viewScope(h.holder.id), holder);
    expect(queue.pairs.find((p) => p.received.id === bank.id)).toMatchObject({
      kind: "INSTALLMENT",
      own: { id: parcel.id },
    });
    const { matchId, kind } = await confirmPair(
      prisma,
      holder,
      { receivedId: bank.id, ownId: parcel.id },
      TEST_CTX,
    );
    expect(kind).toBe("INSTALLMENT");
    expect(await prisma.transaction.findUniqueOrThrow({ where: { id: bank.id } })).toMatchObject({
      installmentGroupId: group.id,
      installmentNumber: 3,
      status: "CONFIRMED",
    });
    await undoMatch(prisma, holder, matchId, TEST_CTX);
    expect(await prisma.transaction.findUniqueOrThrow({ where: { id: parcel.id } })).toMatchObject({
      installmentGroupId: group.id,
      installmentNumber: 3,
      deletedAt: null,
    });
    expect(await prisma.transaction.findUniqueOrThrow({ where: { id: bank.id } })).toMatchObject({
      installmentGroupId: null,
      installmentNumber: null,
      status: "PENDING",
    });
  });

  it("par fora das regras é recusado pelo servidor (a tela não decide)", async () => {
    const own = await mine(h, { amount: "-50.00", occurredOn: "2026-09-01", description: "Café" });
    const bank = await received(h, {
      amount: "-50.00",
      occurredOn: "2026-09-20",
      description: "CAFE",
    });
    expect(
      await codeOf(confirmPair(prisma, holder, { receivedId: bank.id, ownId: own.id }, TEST_CTX)),
    ).toBe("PAIR_NOT_ALLOWED");
  });

  it('"Não é o mesmo": a sugestão não volta', async () => {
    const own = await mine(h, { amount: "-77.70", occurredOn: "2026-10-02", description: "Feira" });
    const bank = await received(h, {
      amount: "-77.70",
      occurredOn: "2026-10-03",
      description: "HORTIFRUTI",
    });
    const before = await reviewQueue(prisma, await viewScope(h.holder.id), holder);
    expect(before.pairs.some((p) => p.received.id === bank.id)).toBe(true);
    await rejectPair(prisma, holder, { receivedId: bank.id, ownId: own.id }, TEST_CTX);
    const after = await reviewQueue(prisma, await viewScope(h.holder.id), holder);
    expect(after.pairs.some((p) => p.received.id === bank.id)).toBe(false);
    expect(after.groups.flatMap((g) => g.items).some((i) => i.id === bank.id)).toBe(true);
  });

  it("estorno: liga ao original, entra no ambiente da compra; o desfazer devolve", async () => {
    const purchase = await mine(h, {
      amount: "-187.72",
      occurredOn: "2026-10-05",
      description: "Restaurante Sabor",
      categoryId: cats.restaurante.id,
    });
    const credit = await received(h, {
      amount: "187.72",
      occurredOn: "2026-10-09",
      description: "ESTORNO RESTAURANTE SABOR",
    });
    const queue = await reviewQueue(prisma, await viewScope(h.holder.id), holder);
    expect(queue.pairs.find((p) => p.received.id === credit.id)).toMatchObject({
      kind: "REFUND",
      own: { id: purchase.id },
    });
    const { matchId } = await linkRefund(
      prisma,
      holder,
      { receivedId: credit.id, originalId: purchase.id },
      TEST_CTX,
    );
    expect(await prisma.transaction.findUniqueOrThrow({ where: { id: credit.id } })).toMatchObject({
      reversalOfId: purchase.id,
      walletId: h.home.id,
      status: "CONFIRMED",
    });
    // A compra continua lá (não é par: são dois lançamentos que se anulam)
    expect(
      (await prisma.transaction.findUniqueOrThrow({ where: { id: purchase.id } })).deletedAt,
    ).toBeNull();
    await undoMatch(prisma, holder, matchId, TEST_CTX);
    expect(await prisma.transaction.findUniqueOrThrow({ where: { id: credit.id } })).toMatchObject({
      reversalOfId: null,
      walletId: h.holderWallet.id,
      status: "PENDING",
    });
  });

  it("estorno de outra loja ou de valor diferente é recusado", async () => {
    const purchase = await mine(h, {
      amount: "-40.00",
      occurredOn: "2026-10-01",
      description: "Padaria",
    });
    const credit = await received(h, {
      amount: "40.00",
      occurredOn: "2026-10-02",
      description: "ESTORNO POSTO",
    });
    expect(
      await codeOf(
        linkRefund(prisma, holder, { receivedId: credit.id, originalId: purchase.id }, TEST_CTX),
      ),
    ).toBe("REFUND_NOT_ALLOWED");
  });

  it("lote: confirma só os que têm categoria e não têm par; o desfazer devolve", async () => {
    const statement = await prisma.cardStatement.create({
      data: {
        accountId: h.card.id,
        referenceMonth: day("2027-01-01"),
        closingDate: day("2027-01-03"),
        dueDate: day("2027-01-09"),
      },
    });
    const inStatement = async (data: Parameters<typeof received>[1]) => {
      const row = await received(h, data);
      return prisma.transaction.update({
        where: { id: row.id },
        data: { statementId: statement.id },
      });
    };
    const ready = await inStatement({
      amount: "-10.00",
      occurredOn: "2026-12-20",
      description: "PADARIA",
      categoryId: cats.padaria.id,
    });
    const noCategory = await inStatement({
      amount: "-11.00",
      occurredOn: "2026-12-21",
      description: "LOJA",
    });
    const withPair = await inStatement({
      amount: "-12.00",
      occurredOn: "2026-12-22",
      description: "MERCADO",
      categoryId: cats.mercado.id,
    });
    await mine(h, { amount: "-12.00", occurredOn: "2026-12-22", description: "Mercado" });

    const { ids } = await confirmBulk(prisma, holder, { statementId: statement.id }, TEST_CTX);
    expect(ids).toEqual([ready.id]);
    const status = async (id: string) =>
      (await prisma.transaction.findUniqueOrThrow({ where: { id } })).status;
    expect(await status(ready.id)).toBe("CONFIRMED");
    expect(await status(noCategory.id)).toBe("PENDING");
    expect(await status(withPair.id)).toBe("PENDING");

    expect(await undoReview(prisma, holder, ids, TEST_CTX)).toEqual({ count: 1 });
    expect(await status(ready.id)).toBe("PENDING");
    expect(await codeOf(undoReview(prisma, holder, ids, TEST_CTX))).toBe("UNDO_EXPIRED");
  });

  it("um a um: confirma no ambiente escolhido; recebido de outra pessoa responde NOT_FOUND", async () => {
    const row = await received(h, {
      amount: "-9.90",
      occurredOn: "2026-10-01",
      description: "BANCA",
    });
    const partner = await editScope(h.partner.id);
    expect(
      await codeOf(confirmReceived(prisma, partner, { transactionId: row.id }, TEST_CTX)),
    ).toBe("NOT_FOUND");
    // Ambiente que a pessoa não edita: recusado antes de gravar
    expect(
      await codeOf(
        confirmReceived(
          prisma,
          holder,
          { transactionId: row.id, walletId: h.partnerWallet.id },
          TEST_CTX,
        ),
      ),
    ).toBe("NOT_FOUND");
    await confirmReceived(prisma, holder, { transactionId: row.id, walletId: h.home.id }, TEST_CTX);
    expect(await prisma.transaction.findUniqueOrThrow({ where: { id: row.id } })).toMatchObject({
      status: "CONFIRMED",
      walletId: h.home.id,
    });
    expect(await codeOf(confirmReceived(prisma, holder, { transactionId: row.id }, TEST_CTX))).toBe(
      "REVIEW_STALE",
    );
    const actions = (
      await prisma.auditLog.findMany({
        where: { householdId: h.householdId },
        select: { action: true },
      })
    ).map((a) => a.action);
    expect(actions).toEqual(
      expect.arrayContaining([
        "transaction.reviewed",
        "transactions.reviewed_bulk",
        "transaction.review_undone",
        "transaction.paired",
        "transaction.pair_rejected",
        "transaction.refund_linked",
        "transaction.match_undone",
      ]),
    );
  });
});

describe("adicional que chega antes do cadastro (final não cadastrado)", () => {
  let h: TestHousehold;
  let grant: ConnectionGrant;
  let provider: PluggyProvider;
  const TODAY = "2026-10-10";
  const NOW = new Date("2026-10-10T15:00:00.000Z");
  const KEYRING = parseKeyring(`1:${randomBytes(32).toString("base64")}`);

  beforeAll(async () => {
    h = await createTestHousehold();
    await prisma.financialAccount.update({
      where: { id: h.card.id },
      data: { closingDay: 27, dueDay: 5 },
    });
    // Só o titular cadastrado (o adicional 2222 da fixture é arquivado): a farmácia vem do 3333
    await prisma.paymentCard.update({
      where: { id: h.additionalCard.id },
      data: { archivedAt: new Date() },
    });
    const bank = syntheticBank(TODAY);
    for (const t of bank.transactions) {
      const meta = t.creditCardMetadata as { cardNumber?: string } | null;
      if (meta?.cardNumber === "0001") meta.cardNumber = "1111";
      if (t.description === "FARMACIA CENTRAL" && meta) meta.cardNumber = "3333";
    }
    const mc = bank.accounts.find((a) => a.id === SYNTHETIC_IDS.mastercard);
    if (mc) mc.number = "1111";
    const fake = createFakePluggy(bank, { pageSize: 50 });
    const owner = await authorizeConnectionOwner(prisma, h.holder.id);
    if (!owner.ok) throw new Error(owner.reason);
    const saved = await saveCredentials(
      prisma,
      owner.grant,
      {
        clientId: SYNTHETIC_CREDENTIALS.clientId,
        clientSecret: SYNTHETIC_CREDENTIALS.clientSecret,
        itemIds: [SYNTHETIC_IDS.itemAurora],
      },
      KEYRING,
      TEST_CTX,
    );
    const again = await authorizeConnectionOwner(prisma, h.holder.id);
    if (!again.ok) throw new Error(again.reason);
    grant = again.grant;
    provider = (await providerForConnection(prisma, saved.connectionId, KEYRING, {
      baseUrl: "http://pluggy.test",
      fetch: fake.fetch,
    })) as PluggyProvider;
    const accounts = await provider.listAccounts(SYNTHETIC_IDS.itemAurora);
    await linkAccounts(
      prisma,
      grant,
      {
        bank: accounts.map((a) => ({
          externalId: a.externalId,
          kind: a.kind,
          name: a.name,
          number: a.number,
          institution: "Banco Aurora",
          credit: a.credit
            ? { closeDate: a.credit.closeDate, dueDate: a.credit.dueDate, brand: a.credit.brand }
            : null,
        })),
        importFrom: "2026-08-01",
        today: TODAY,
        choices: [
          { externalId: SYNTHETIC_IDS.mastercard, target: "existing", accountId: h.card.id },
        ],
      },
      TEST_CTX,
    );
    const outcome = await runSync(prisma, {
      connectionId: grant.connectionId as string,
      trigger: "MANUAL",
      provider,
      now: NOW,
    });
    expect(outcome.status).toBe("SUCCEEDED");
  });
  afterAll(async () => {
    await deleteTestHousehold(h);
  });

  const farmacia = () =>
    prisma.transaction.findFirstOrThrow({
      where: { householdId: h.householdId, description: "FARMACIA CENTRAL" },
      select: { cardId: true, walletId: true, providerCardLastFour: true },
    });

  it("final que não está cadastrado fica SEM cartão (não vai para o titular) e guarda o final", async () => {
    expect(await farmacia()).toEqual({
      cardId: null,
      walletId: h.holderWallet.id,
      providerCardLastFour: "3333",
    });
    const mercado = await prisma.transaction.findFirstOrThrow({
      where: { householdId: h.householdId, description: "MERCADO BOM PRECO" },
      select: { cardId: true, providerCardLastFour: true },
    });
    expect(mercado).toEqual({ cardId: h.holderCard.id, providerCardLastFour: "1111" });
  });

  it("a fila mostra o final não cadastrado", async () => {
    const queue = await reviewQueue(
      prisma,
      await viewScope(h.holder.id),
      await editScope(h.holder.id),
    );
    expect(queue.finals).toEqual([
      expect.objectContaining({ lastFour: "3333", count: 1, accountId: h.card.id }),
    ]);
  });

  it("cadastrar o final da parceira: o recebido vai para o cartão e o ambiente dela", async () => {
    const access = await authorizeWallet(prisma, h.holder.id, h.holderWallet.id, "manage_accounts");
    if (!access.ok) throw new Error(access.reason);
    const card = await createCard(
      prisma,
      access.grant,
      h.card.id,
      {
        nickname: "Virtual parceira",
        brand: "Mastercard",
        lastFour: "3333",
        form: "VIRTUAL",
        isAdditional: true,
        holderId: h.partner.id,
      },
      TEST_CTX,
    );
    expect(card.rerouted).toBe(1);
    expect(await farmacia()).toEqual({
      cardId: card.id,
      walletId: h.partnerWallet.id,
      providerCardLastFour: "3333",
    });
    // Buscar de novo não desfaz nem duplica
    const outcome = await runSync(prisma, {
      connectionId: grant.connectionId as string,
      trigger: "SCHEDULED",
      provider,
      now: new Date(NOW.getTime() + 60_000),
    });
    expect(outcome).toMatchObject({ status: "SUCCEEDED", created: 0, updated: 0 });
    expect((await farmacia()).cardId).toBe(card.id);
  });
});
