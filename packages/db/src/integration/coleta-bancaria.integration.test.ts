// Coleta bancária (M09.1): credenciais cifradas, ligação das contas, sincronização idempotente,
// fatura do banco conferida ao centavo, adicional do cônjuge no ambiente de quem usou, recebidos
// fora das somas e as regras novas do banco. Tudo contra a Pluggy DE MENTIRA (banco sintético):
// nenhum teste chama a Pluggy de verdade.
import { randomBytes } from "node:crypto";
import { PluggyProvider } from "@fintrack/importers";
import {
  createFakePluggy,
  SYNTHETIC_CREDENTIALS,
  SYNTHETIC_IDS,
  syntheticBank,
  type SyntheticBank,
} from "@fintrack/importers/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  authorizeAccountView,
  authorizeConnectionOwner,
  authorizeHousehold,
  authorizeScope,
  authorizeTransaction,
  fromDbDecimal,
  cardStatementView,
  linkAccounts,
  listTransactions,
  openSecret,
  parseKeyring,
  providerForConnection,
  receivedSummary,
  runSync,
  saveCredentials,
  sealSecret,
  setTransactionCategory,
  spendingRows,
  sumTransactions,
  type BankAccountForLink,
  type ConnectionGrant,
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

const TODAY = "2026-10-10";
const NOW = new Date("2026-10-10T15:00:00.000Z");
const IMPORT_FROM = "2026-08-01";
const key = () => randomBytes(32).toString("base64");
const KEYRING = parseKeyring(`1:${key()}`);

/** O banco sintético com os finais dos cartões do lar de teste (1111 titular, 2222 adicional). */
function bankFor(h: TestHousehold): SyntheticBank {
  const bank = syntheticBank(TODAY);
  for (const t of bank.transactions) {
    const meta = t.creditCardMetadata as { cardNumber?: string } | null;
    if (meta && meta.cardNumber === "0001") meta.cardNumber = "1111";
  }
  // A parceira usou o adicional (final 2222) na farmácia e no restaurante
  for (const t of bank.transactions) {
    if (t.description === "FARMACIA CENTRAL" || t.description === "RESTAURANTE SABOR") {
      (t.creditCardMetadata as { cardNumber: string }).cardNumber = "2222";
    }
  }
  const mc = bank.accounts.find((a) => a.id === SYNTHETIC_IDS.mastercard);
  if (mc) mc.number = "1111";
  void h;
  return bank;
}

async function grantOf(userId: string): Promise<ConnectionGrant> {
  const access = await authorizeConnectionOwner(prisma, userId);
  if (!access.ok) throw new Error(`sem acesso à conexão: ${access.reason}`);
  return access.grant;
}

/** Contas do banco como o servidor busca na hora de ligar (Banco Aurora). */
async function bankAccountsFor(provider: PluggyProvider): Promise<BankAccountForLink[]> {
  const accounts = await provider.listAccounts(SYNTHETIC_IDS.itemAurora);
  return accounts.map((a) => ({
    externalId: a.externalId,
    kind: a.kind,
    name: a.name,
    number: a.number,
    institution: "Banco Aurora",
    credit: a.credit
      ? { closeDate: a.credit.closeDate, dueDate: a.credit.dueDate, brand: a.credit.brand }
      : null,
  }));
}

describe("cifragem do Client Secret", () => {
  it("cifra e decifra; outra conexão, outra chave ou bytes alterados não decifram", () => {
    const sealed = sealSecret(KEYRING, "conexao-a", "segredo-123");
    expect(Buffer.from(sealed).toString("utf8")).not.toContain("segredo-123");
    expect(openSecret(KEYRING, "conexao-a", sealed)).toBe("segredo-123");
    expect(() => openSecret(KEYRING, "conexao-b", sealed)).toThrow(/não decifra/);
    expect(() => openSecret(parseKeyring(`1:${key()}`), "conexao-a", sealed)).toThrow(
      /não decifra/,
    );
    const tampered = new Uint8Array(sealed);
    tampered[tampered.length - 1] = (tampered[tampered.length - 1] ?? 0) ^ 1;
    expect(() => openSecret(KEYRING, "conexao-a", tampered)).toThrow(/não decifra/);
  });

  it("troca de chave: a nova cifra, a antiga continua decifrando o que já estava gravado", () => {
    const old = parseKeyring(`1:${key()}`);
    const sealed = sealSecret(old, "c", "antigo");
    const rotated = parseKeyring(`2:${key()},1:${(old.keys.get(1) as Buffer).toString("base64")}`);
    expect(openSecret(rotated, "c", sealed)).toBe("antigo");
    expect(sealSecret(rotated, "c", "novo")[0]).toBe(2);
  });

  it("recusa chave curta, versão repetida e formato errado (sem mostrar a chave)", () => {
    expect(() => parseKeyring("1:abc")).toThrow(/32 bytes/);
    expect(() => parseKeyring(`1:${key()},1:${key()}`)).toThrow(/repetida/);
    expect(() => parseKeyring("chave")).toThrow(/formato/);
    expect(() => parseKeyring("")).toThrow(/vazia/);
  });
});

describe("conexão, ligação e sincronização", () => {
  let h: TestHousehold;
  let fake: ReturnType<typeof createFakePluggy>;
  let grant: ConnectionGrant;
  let provider: PluggyProvider;

  beforeAll(async () => {
    h = await createTestHousehold();
    // O cartão do lar de teste com o ciclo do banco sintético (fecha 27, vence 5)
    await prisma.financialAccount.update({
      where: { id: h.card.id },
      data: { closingDay: 27, dueDay: 5 },
    });
    fake = createFakePluggy(bankFor(h), { pageSize: 7 });
    grant = await grantOf(h.holder.id);
    const saved = await saveCredentials(
      prisma,
      grant,
      {
        clientId: SYNTHETIC_CREDENTIALS.clientId,
        clientSecret: SYNTHETIC_CREDENTIALS.clientSecret,
        itemIds: [SYNTHETIC_IDS.itemAurora],
      },
      KEYRING,
      TEST_CTX,
    );
    grant = await grantOf(h.holder.id);
    expect(grant.connectionId).toBe(saved.connectionId);
    provider = (await providerForConnection(prisma, saved.connectionId, KEYRING, {
      baseUrl: "http://pluggy.test",
      fetch: fake.fetch,
    })) as PluggyProvider;
    const bank = await bankAccountsFor(provider);
    await linkAccounts(
      prisma,
      grant,
      {
        bank,
        importFrom: IMPORT_FROM,
        today: TODAY,
        choices: [
          { externalId: SYNTHETIC_IDS.checking, target: "existing", accountId: h.checking.id },
          { externalId: SYNTHETIC_IDS.mastercard, target: "existing", accountId: h.card.id },
        ],
      },
      TEST_CTX,
    );
  });

  afterAll(async () => {
    await deleteTestHousehold(h);
  });

  it("o segredo fica cifrado no banco e a auditoria não guarda credencial nem Item ID", async () => {
    const row = await prisma.providerConnection.findUniqueOrThrow({
      where: { id: grant.connectionId as string },
    });
    expect(Buffer.from(row.secretCiphertext as Uint8Array).toString("utf8")).not.toContain(
      SYNTHETIC_CREDENTIALS.clientSecret,
    );
    const audit = await prisma.auditLog.findMany({ where: { householdId: h.householdId } });
    const text = JSON.stringify(audit, (_k, v: unknown) => (typeof v === "bigint" ? String(v) : v));
    expect(audit.map((a) => a.action)).toEqual(
      expect.arrayContaining(["connection.saved", "connection.accounts_linked"]),
    );
    for (const secret of [
      SYNTHETIC_CREDENTIALS.clientSecret,
      SYNTHETIC_CREDENTIALS.clientId,
      SYNTHETIC_IDS.itemAurora,
    ]) {
      expect(text).not.toContain(secret);
    }
  });

  it("primeira busca: tudo entra como recebido (PENDING), na conta e no ambiente certos", async () => {
    const outcome = await runSync(prisma, {
      connectionId: grant.connectionId as string,
      trigger: "MANUAL",
      provider,
      requestedById: h.holder.id,
      now: NOW,
    });
    expect(outcome.status).toBe("SUCCEEDED");
    if (outcome.status !== "SUCCEEDED") return;
    // Mastercard: 7 da fatura aberta + 31 da fatura de setembro; conta corrente: 4
    expect(outcome.created).toBe(42);
    const rows = await prisma.transaction.findMany({
      where: { householdId: h.householdId, source: "OPEN_FINANCE" },
    });
    expect(rows.every((r) => r.status === "PENDING")).toBe(true);
    // O pagamento recebido dentro do cartão NÃO vira lançamento (a perna vem da conta corrente)
    expect(rows.some((r) => r.description === "PAGAMENTO RECEBIDO")).toBe(false);
  });

  it("buscar de novo cria ZERO lançamentos (idempotência)", async () => {
    // A segunda busca relê só os últimos 40 dias (desde 31/08): 3 compras de 28 a 30/08 ficam
    // fora do período, e as outras 39 voltam iguais
    const before = await prisma.transaction.count({ where: { householdId: h.householdId } });
    const outcome = await runSync(prisma, {
      connectionId: grant.connectionId as string,
      trigger: "SCHEDULED",
      provider,
      now: new Date(NOW.getTime() + 60_000),
    });
    expect(outcome).toMatchObject({ status: "SUCCEEDED", created: 0, updated: 0, unchanged: 39 });
    expect(await prisma.transaction.count({ where: { householdId: h.householdId } })).toBe(before);
  });

  it("adicional da parceira: a compra entra no ambiente pessoal dela, com Pago por = parceira", async () => {
    const farmacia = await prisma.transaction.findFirstOrThrow({
      where: { householdId: h.householdId, description: "FARMACIA CENTRAL" },
      select: { walletId: true, cardId: true },
    });
    expect(farmacia).toEqual({ walletId: h.partnerWallet.id, cardId: h.additionalCard.id });
    const mercado = await prisma.transaction.findFirstOrThrow({
      where: { householdId: h.householdId, description: "MERCADO BOM PRECO" },
      select: { walletId: true, cardId: true },
    });
    expect(mercado).toEqual({ walletId: h.holderWallet.id, cardId: h.holderCard.id });
  });

  it("a fatura de setembro confere ao centavo com a Bill (compras + IOF = total) e está paga", async () => {
    const access = await authorizeAccountView(prisma, h.holder.id, h.card.id);
    if (!access.ok) throw new Error("titular sem acesso ao cartão");
    const view = await cardStatementView(prisma, access.grant, TODAY);
    const september = view.statements[0];
    expect(september).toMatchObject({
      referenceMonth: "2026-09",
      closingDate: "2026-09-27",
      dueDate: "2026-10-05",
      total: 214635n,
      minimumPayment: 32195n,
      purchases: 214223n,
      purchaseCount: 31,
      charges: [{ kind: "IOF", amount: 412n }],
      check: { kind: "matches" },
      status: "PAID",
    });
    // Fatura aberta: as 7 compras recebidas (inclusive as da parceira) somam R$ 1.284,90
    expect(view.openTotal).toBe(128490n);
    expect(view.open).toHaveLength(7);
    expect(view.open.find((t) => t.description === "RESTAURANTE SABOR")?.otherWallet).toBe(
      "Parceira",
    );
    expect(view.open.find((t) => t.description === "LOJA ONLINE AGIL")?.original).toEqual({
      amount: 4861n,
      currency: "USD",
    });
    expect(view.balance).toMatchObject({ creditLimit: 800000n, availableCredit: 611510n });
  });

  it("recebidos ficam fora da lista padrão, dos totais e do painel; aparecem em situacao=recebidos", async () => {
    const scope = await authorizeScope(prisma, h.holder.id, "view");
    const base = { from: "2026-08-01", to: TODAY };
    expect((await listTransactions(prisma, scope, base)).items).toHaveLength(0);
    expect((await sumTransactions(prisma, scope, base)).count).toBe(0);
    const received = await listTransactions(prisma, scope, { ...base, received: true }, null, 100);
    expect(received.items.length).toBeGreaterThan(30);
    const rows = await spendingRows(prisma, scope, {
      from: "2026-08",
      to: "2026-10",
      today: TODAY,
    });
    expect(rows).toHaveLength(0);
    expect((await receivedSummary(prisma, scope.walletIds)).count).toBe(received.items.length);
  });

  it("o banco corrige um recebido: atualiza só ele; o que a pessoa já conferiu não muda", async () => {
    const confirmed = await prisma.transaction.findFirstOrThrow({
      where: { householdId: h.householdId, description: "POSTO ESTRELA" },
    });
    await prisma.transaction.update({ where: { id: confirmed.id }, data: { status: "CONFIRMED" } });
    const bank = bankFor(h);
    for (const t of bank.transactions) {
      if (t.description === "MERCADO BOM PRECO") t.amount = { $money: "312.50" };
      if (t.description === "POSTO ESTRELA") t.amount = { $money: "999.99" };
    }
    fake.setBank(bank);
    const outcome = await runSync(prisma, {
      connectionId: grant.connectionId as string,
      trigger: "SCHEDULED",
      provider,
      now: new Date(NOW.getTime() + 120_000),
    });
    expect(outcome).toMatchObject({ status: "SUCCEEDED", created: 0, updated: 1 });
    const posto = await prisma.transaction.findUniqueOrThrow({ where: { id: confirmed.id } });
    expect(fromDbDecimal(posto.amount)).toBe(-22000n);
    fake.setBank(bankFor(h));
  });

  it("categoria em um clique: grava MANUAL, vira exemplo ao corrigir e cria a regra se pedido", async () => {
    const cats = await createTestCategories(h.householdId);
    const target = await prisma.transaction.findFirstOrThrow({
      where: { householdId: h.householdId, description: "MERCADO BOM PRECO" },
    });
    const access = await authorizeTransaction(prisma, h.holder.id, target.id, "edit");
    if (!access.ok) throw new Error("sem acesso");
    const household = await authorizeHousehold(prisma, h.holder.id, "manage_categories");
    if (!household.ok) throw new Error("sem lar");
    await setTransactionCategory(prisma, access.grant, cats.restaurante.id, {}, TEST_CTX);
    await setTransactionCategory(
      prisma,
      access.grant,
      cats.mercado.id,
      { rememberRule: { grant: household.grant } },
      TEST_CTX,
    );
    const after = await prisma.transaction.findUniqueOrThrow({ where: { id: target.id } });
    expect(after).toMatchObject({
      categoryId: cats.mercado.id,
      categorizedBy: "MANUAL",
      status: "PENDING",
    });
    expect(await prisma.categorizationExample.count({ where: { transactionId: target.id } })).toBe(
      1,
    );
    expect(
      await prisma.categoryRule.findFirst({
        where: { householdId: h.householdId, categoryId: cats.mercado.id },
      }),
    ).toMatchObject({
      pattern: "mercado bom preco",
    });
    // A categoria de despesa não vai numa entrada
    const salary = await prisma.transaction.findFirstOrThrow({
      where: { householdId: h.householdId, description: "SALARIO EMPRESA EXEMPLO" },
    });
    const salaryAccess = await authorizeTransaction(prisma, h.holder.id, salary.id, "edit");
    if (!salaryAccess.ok) throw new Error("sem acesso");
    await expect(
      setTransactionCategory(prisma, salaryAccess.grant, cats.mercado.id, {}, TEST_CTX),
    ).rejects.toMatchObject({
      code: "CATEGORY_INVALID",
    });
  });

  it("na busca seguinte, a regra nova categoriza o que chega (categorizedBy RULE)", async () => {
    const bank = bankFor(h);
    const copy = {
      ...(bank.transactions[0] as Record<string, unknown>),
      id: "7e570000-0000-4000-8000-000000009999",
      description: "MERCADO BOM PRECO LOJA 2",
    };
    bank.transactions.push(copy as SyntheticBank["transactions"][number]);
    fake.setBank(bank);
    await runSync(prisma, {
      connectionId: grant.connectionId as string,
      trigger: "MANUAL",
      provider,
      now: new Date(NOW.getTime() + 180_000),
    });
    const row = await prisma.transaction.findFirstOrThrow({
      where: { householdId: h.householdId, description: "MERCADO BOM PRECO LOJA 2" },
    });
    expect(row.categorizedBy).toBe("RULE");
    fake.setBank(bankFor(h));
  });

  it("a parcela seguinte chega com o O que foi e a categoria da anterior (M13.2)", async () => {
    // A parcela 3/6 da livraria, nomeada e conferida pela pessoa
    const category = await prisma.category.findFirstOrThrow({
      where: { householdId: h.householdId, kind: "EXPENSE", archivedAt: null },
      orderBy: { name: "asc" },
    });
    const third = await prisma.transaction.findFirstOrThrow({
      where: { householdId: h.householdId, description: "LIVRARIA NOBRE PARC 03/06" },
    });
    await prisma.transaction.update({
      where: { id: third.id },
      data: { label: "Coleção de contos", categoryId: category.id, status: "CONFIRMED" },
    });
    // O banco manda a 4/6 (mesma compra) e uma compra parecida de outro valor (outra compra)
    const bank = bankFor(h);
    const base = bank.transactions.find((t) => t.description === "LIVRARIA NOBRE PARC 03/06");
    if (!base) throw new Error("a parcela sintética sumiu");
    const meta = base.creditCardMetadata as Record<string, unknown>;
    const next = {
      ...base,
      id: "7e570000-0000-4000-8000-000000009998",
      description: "LIVRARIA NOBRE PARC 04/06",
      creditCardMetadata: { ...meta, installmentNumber: 4 },
    };
    const other = {
      ...base,
      id: "7e570000-0000-4000-8000-000000009997",
      description: "LIVRARIA NOBRE PARC 01/06",
      amount: { $money: "99.90" },
      creditCardMetadata: { ...meta, installmentNumber: 1 },
    };
    bank.transactions.push(next, other);
    fake.setBank(bank);
    await runSync(prisma, {
      connectionId: grant.connectionId as string,
      trigger: "MANUAL",
      provider,
      now: new Date(NOW.getTime() + 210_000),
    });
    const fourth = await prisma.transaction.findFirstOrThrow({
      where: { householdId: h.householdId, description: "LIVRARIA NOBRE PARC 04/06" },
    });
    expect(fourth).toMatchObject({
      label: "Coleção de contos",
      categoryId: category.id,
      categorizedBy: "HISTORY",
      categorizationConfidence: 100,
      status: "PENDING", // a pessoa ainda confere: herdar não é confirmar
    });
    const another = await prisma.transaction.findFirstOrThrow({
      where: { householdId: h.householdId, description: "LIVRARIA NOBRE PARC 01/06" },
    });
    expect(another.label).toBeNull();
    fake.setBank(bankFor(h));
  });

  it("credenciais recusadas: a busca falha com o CÓDIGO, nada é gravado e a conexão fica em erro", async () => {
    const wrong = new PluggyProvider({
      credentials: { clientId: SYNTHETIC_CREDENTIALS.clientId, clientSecret: "outro-segredo" },
      baseUrl: "http://pluggy.test",
      fetch: fake.fetch,
    });
    const before = await prisma.transaction.count({ where: { householdId: h.householdId } });
    const outcome = await runSync(prisma, {
      connectionId: grant.connectionId as string,
      trigger: "SCHEDULED",
      provider: wrong,
      now: new Date(NOW.getTime() + 240_000),
    });
    expect(outcome).toMatchObject({ status: "FAILED", error: "PROVIDER_AUTH_FAILED" });
    expect(await prisma.transaction.count({ where: { householdId: h.householdId } })).toBe(before);
    const run = await prisma.syncRun.findFirstOrThrow({
      where: { connectionId: grant.connectionId as string },
      orderBy: { startedAt: "desc" },
    });
    expect(run).toMatchObject({ status: "FAILED", error: "PROVIDER_AUTH_FAILED" });
    expect(
      (
        await prisma.providerConnection.findUniqueOrThrow({
          where: { id: grant.connectionId as string },
        })
      ).status,
    ).toBe("ERROR");
  });

  it("uma busca por vez: com outra em andamento, a segunda não começa", async () => {
    const running = await prisma.syncRun.create({
      data: { connectionId: grant.connectionId as string, startedAt: NOW },
    });
    const outcome = await runSync(prisma, {
      connectionId: grant.connectionId as string,
      trigger: "MANUAL",
      provider,
      now: new Date(NOW.getTime() + 60_000),
    });
    expect(outcome.status).toBe("ALREADY_RUNNING");
    await prisma.syncRun.update({
      where: { id: running.id },
      data: { status: "FAILED", finishedAt: NOW },
    });
  });

  it("acesso: a parceira não vê a página do cartão do titular nem a conexão dele", async () => {
    expect((await authorizeAccountView(prisma, h.partner.id, h.card.id)).ok).toBe(false);
    const partnerGrant = await grantOf(h.partner.id);
    expect(partnerGrant.connectionId).toBeNull();
    // Ligar a conta do titular pela conexão da parceira: a conta nem aparece para ela
    await saveCredentials(
      prisma,
      partnerGrant,
      {
        clientId: SYNTHETIC_CREDENTIALS.clientId,
        clientSecret: "x".repeat(20),
        itemIds: [SYNTHETIC_IDS.itemExemplo],
      },
      KEYRING,
      TEST_CTX,
    );
    const again = await grantOf(h.partner.id);
    await expect(
      linkAccounts(
        prisma,
        again,
        {
          bank: [
            {
              externalId: "outra",
              kind: "CHECKING",
              name: "Conta",
              number: null,
              institution: null,
              credit: null,
            },
          ],
          importFrom: TODAY,
          today: TODAY,
          choices: [{ externalId: "outra", target: "existing", accountId: h.checking.id }],
        },
        TEST_CTX,
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("limites da conexão: de 1 a 5 bancos, Item ID no formato, data de corte até 12 meses", async () => {
    const base = { clientId: SYNTHETIC_CREDENTIALS.clientId, clientSecret: null };
    await expect(
      saveCredentials(prisma, grant, { ...base, itemIds: [] }, KEYRING, TEST_CTX),
    ).rejects.toMatchObject({ code: "CONNECTION_ITEMS_LIMIT" });
    await expect(
      saveCredentials(
        prisma,
        grant,
        { ...base, itemIds: ["a1", "b2", "c3", "d4", "e5", "f6"].map((x) => `${x}-0000-4000`) },
        KEYRING,
        TEST_CTX,
      ),
    ).rejects.toMatchObject({ code: "CONNECTION_ITEMS_LIMIT" });
    await expect(
      saveCredentials(prisma, grant, { ...base, itemIds: ["<script>"] }, KEYRING, TEST_CTX),
    ).rejects.toMatchObject({ code: "CONNECTION_ITEM_INVALID" });
    await expect(
      linkAccounts(
        prisma,
        grant,
        { bank: [], choices: [], importFrom: "2025-09-01", today: TODAY },
        TEST_CTX,
      ),
    ).rejects.toMatchObject({ code: "IMPORT_FROM_INVALID" });
  });
});

describe("adicional com ambiente escolhido (Compras do adicional entram em…)", () => {
  let h: TestHousehold;
  let grant: ConnectionGrant;
  let provider: PluggyProvider;

  beforeAll(async () => {
    h = await createTestHousehold();
    await prisma.financialAccount.update({
      where: { id: h.card.id },
      data: { closingDay: 27, dueDay: 5 },
    });
    const fake = createFakePluggy(bankFor(h), { pageSize: 50 });
    const saved = await saveCredentials(
      prisma,
      await grantOf(h.holder.id),
      {
        clientId: SYNTHETIC_CREDENTIALS.clientId,
        clientSecret: SYNTHETIC_CREDENTIALS.clientSecret,
        itemIds: [SYNTHETIC_IDS.itemAurora],
      },
      KEYRING,
      TEST_CTX,
    );
    grant = await grantOf(h.holder.id);
    provider = (await providerForConnection(prisma, saved.connectionId, KEYRING, {
      baseUrl: "http://pluggy.test",
      fetch: fake.fetch,
    })) as PluggyProvider;
  });

  afterAll(async () => {
    await deleteTestHousehold(h);
  });

  const link = async (walletId: string | null) =>
    linkAccounts(
      prisma,
      grant,
      {
        bank: await bankAccountsFor(provider),
        importFrom: IMPORT_FROM,
        today: TODAY,
        choices: [
          { externalId: SYNTHETIC_IDS.mastercard, target: "existing", accountId: h.card.id },
        ],
        cardWallets: [{ cardId: h.additionalCard.id, walletId }],
      },
      TEST_CTX,
    );

  it("recusa um ambiente de que a dona do adicional não participa (o pessoal do titular)", async () => {
    await expect(link(h.holderWallet.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    const card = await prisma.paymentCard.findUniqueOrThrow({
      where: { id: h.additionalCard.id },
      select: { importWalletId: true },
    });
    expect(card.importWalletId).toBeNull();
  });

  it("com a Casa escolhida, as compras do adicional entram na Casa; as do titular, não", async () => {
    await link(h.home.id);
    const outcome = await runSync(prisma, {
      connectionId: grant.connectionId as string,
      trigger: "MANUAL",
      provider,
      requestedById: h.holder.id,
      now: NOW,
    });
    expect(outcome.status).toBe("SUCCEEDED");
    const farmacia = await prisma.transaction.findFirstOrThrow({
      where: { householdId: h.householdId, description: "FARMACIA CENTRAL" },
      select: { walletId: true, cardId: true },
    });
    expect(farmacia).toEqual({ walletId: h.home.id, cardId: h.additionalCard.id });
    const mercado = await prisma.transaction.findFirstOrThrow({
      where: { householdId: h.householdId, description: "MERCADO BOM PRECO" },
      select: { walletId: true },
    });
    expect(mercado.walletId).toBe(h.holderWallet.id);
  });

  it("chave do servidor que não decifra o segredo: a busca fica registrada como falha, com código", async () => {
    const other = parseKeyring(`1:${key()}`);
    const outcome = await runSync(prisma, {
      connectionId: grant.connectionId as string,
      trigger: "SCHEDULED",
      provider: () => providerForConnection(prisma, grant.connectionId as string, other),
      now: new Date(NOW.getTime() + 120_000),
    });
    expect(outcome).toMatchObject({ status: "FAILED", error: "CONNECTION_SECRET_UNREADABLE" });
    const connection = await prisma.providerConnection.findUniqueOrThrow({
      where: { id: grant.connectionId as string },
      select: { status: true },
    });
    expect(connection.status).toBe("ERROR");
  });

  it("voltar ao padrão (sem ambiente) devolve a escolha ao ambiente pessoal da dona", async () => {
    await link(null);
    const card = await prisma.paymentCard.findUniqueOrThrow({
      where: { id: h.additionalCard.id },
      select: { importWalletId: true },
    });
    expect(card.importWalletId).toBeNull();
  });
});

describe("regras do banco (CHECKs do M09.1)", () => {
  let h: TestHousehold;
  beforeAll(async () => {
    h = await createTestHousehold();
  });
  afterAll(async () => {
    await deleteTestHousehold(h);
  });

  const base = () => ({
    householdId: h.householdId,
    walletId: h.holderWallet.id,
    accountId: h.card.id,
    method: "CREDIT" as const,
    amount: "-10.00",
    occurredOn: new Date("2026-10-01"),
    description: "Teste",
    source: "OPEN_FINANCE" as const,
    externalId: `x-${randomBytes(4).toString("hex")}`,
  });

  it("valor original e moeda andam juntos, moeda com 3 letras", async () => {
    expect(
      await dbError(prisma.transaction.create({ data: { ...base(), originalAmount: "48.61" } })),
    ).toContain("transaction_original_amount_check");
    expect(
      await dbError(
        prisma.transaction.create({
          data: { ...base(), originalAmount: "48.61", originalCurrency: "us$" },
        }),
      ),
    ).toContain("transaction_original_amount_check");
  });

  it("parcela do banco: os dois números juntos e número dentro do total", async () => {
    expect(
      await dbError(
        prisma.transaction.create({ data: { ...base(), providerInstallmentNumber: 3 } }),
      ),
    ).toContain("transaction_provider_installment_check");
    expect(
      await dbError(
        prisma.transaction.create({
          data: { ...base(), providerInstallmentNumber: 7, providerInstallmentCount: 6 },
        }),
      ),
    ).toContain("transaction_provider_installment_check");
  });

  it("categoria do banco: de 1 a 100 caracteres", async () => {
    expect(
      await dbError(prisma.transaction.create({ data: { ...base(), providerCategory: "  " } })),
    ).toContain("transaction_provider_category_check");
  });

  it("saldo: limite nunca negativo; moeda em maiúsculas", async () => {
    expect(
      await dbError(
        prisma.accountBalance.create({
          data: { accountId: h.card.id, creditLimit: "-1.00", asOf: new Date() },
        }),
      ),
    ).toContain("account_balance_credit_check");
    expect(
      await dbError(
        prisma.accountBalance.create({
          data: { accountId: h.card.id, currency: "brl", asOf: new Date() },
        }),
      ),
    ).toContain("account_balance_currency_check");
  });

  it("Item ID só com letras, números e hífen", async () => {
    const connection = await prisma.providerConnection.create({
      data: { userId: h.holder.id, walletId: h.holderWallet.id, provider: "PLUGGY" },
    });
    expect(
      await dbError(
        prisma.providerItem.create({
          data: { connectionId: connection.id, externalId: "item id com espaço" },
        }),
      ),
    ).toContain("provider_item_external_id_check");
  });

  it("encargo nunca negativo; pagamento sempre positivo", async () => {
    const statement = await prisma.cardStatement.create({
      data: {
        accountId: h.card.id,
        referenceMonth: new Date("2026-09-01"),
        closingDate: new Date("2026-09-03"),
        dueDate: new Date("2026-09-09"),
      },
    });
    expect(
      await dbError(
        prisma.statementCharge.create({
          data: { statementId: statement.id, accountId: h.card.id, kind: "IOF", amount: "-1.00" },
        }),
      ),
    ).toContain("statement_charge_amount_check");
    expect(
      await dbError(
        prisma.statementPayment.create({
          data: {
            statementId: statement.id,
            accountId: h.card.id,
            paidOn: new Date("2026-09-09"),
            amount: "0.00",
          },
        }),
      ),
    ).toContain("statement_payment_amount_check");
  });

  it("uma conexão por pessoa e provedor", async () => {
    const other = await prisma.providerConnection.findFirst({ where: { userId: h.holder.id } });
    const data = { userId: h.holder.id, walletId: h.holderWallet.id, provider: "PLUGGY" as const };
    if (!other) await prisma.providerConnection.create({ data });
    expect(await dbError(prisma.providerConnection.create({ data }))).toContain(
      "provider_connection_userId_provider_key",
    );
  });
});
