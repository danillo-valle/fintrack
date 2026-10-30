import { describe, expect, it } from "vitest";
import { isProviderError } from "../provider";
import { createFakePluggy } from "../testing/fake-pluggy";
import { SYNTHETIC_CREDENTIALS, SYNTHETIC_IDS, syntheticBank } from "../testing/synthetic";
import { PluggyProvider } from "./adapter";

const TODAY = "2026-10-10";

function provider(
  options: Parameters<typeof createFakePluggy>[1] = {},
  credentials: { clientId: string; clientSecret: string } = SYNTHETIC_CREDENTIALS,
) {
  const fake = createFakePluggy(syntheticBank(TODAY), options);
  return {
    fake,
    provider: new PluggyProvider({ credentials, baseUrl: "http://pluggy.test", fetch: fake.fetch }),
  };
}

describe("PluggyProvider · contas", () => {
  it("normaliza contas: centavos, tipo, só o final do cartão e as datas da fatura aberta", async () => {
    const { provider: p } = provider();
    const accounts = await p.listAccounts(SYNTHETIC_IDS.itemAurora);
    expect(accounts).toEqual([
      {
        externalId: SYNTHETIC_IDS.checking,
        itemExternalId: SYNTHETIC_IDS.itemAurora,
        kind: "CHECKING",
        name: "Conta Corrente",
        number: "12345-6",
        currency: "BRL",
        balance: 421836n,
        credit: null,
      },
      {
        externalId: SYNTHETIC_IDS.mastercard,
        itemExternalId: SYNTHETIC_IDS.itemAurora,
        kind: "CREDIT_CARD",
        name: "Mastercard Gold",
        number: "0001",
        currency: "BRL",
        balance: null,
        credit: {
          limit: 800000n,
          available: 611510n,
          closeDate: "2026-10-27",
          dueDate: "2026-11-05",
          brand: "MASTERCARD",
        },
      },
    ]);
  });

  it("o banco e a hora da última atualização do Meu Pluggy", async () => {
    const { provider: p } = provider();
    const item = await p.getItem(SYNTHETIC_IDS.itemExemplo);
    expect(item.institution).toBe("Banco Exemplo");
    expect(item.updatedAt?.toISOString()).toBe("2026-10-10T08:12:00.000Z");
  });

  it("Item ID que não existe é PROVIDER_NOT_FOUND", async () => {
    const { provider: p } = provider();
    await expect(p.listAccounts("ffffffff-0000-4000-8000-000000000000")).rejects.toMatchObject({
      code: "PROVIDER_NOT_FOUND",
    });
  });
});

describe("PluggyProvider · lançamentos", () => {
  it("segue o cursor até o fim, sinal pelo tipo, parcela, compra em dólar e pagamento da fatura", async () => {
    const { provider: p, fake } = provider({ pageSize: 3 });
    await p.listAccounts(SYNTHETIC_IDS.itemAurora);
    const { transactions, skipped } = await p.listTransactions(SYNTHETIC_IDS.mastercard, {
      from: "2026-10-01",
      to: TODAY,
    });
    expect(skipped).toBe(0);
    expect(fake.calls.filter((c) => c === "GET /v2/transactions")).toHaveLength(3); // 8 itens, 3 por página
    const purchases = transactions.filter((t) => !t.isBillPayment);
    expect(purchases).toHaveLength(7);
    expect(purchases.reduce((sum, t) => sum + t.amount, 0n)).toBe(-128490n);
    const mercado = purchases.find((t) => t.description === "MERCADO BOM PRECO");
    expect(mercado).toMatchObject({
      amount: -31248n,
      occurredOn: "2026-10-09",
      status: "PENDING",
      cardLastFour: "0001",
    });
    expect(purchases.find((t) => t.description.startsWith("LIVRARIA"))?.installment).toEqual({
      number: 3,
      count: 6,
    });
    expect(purchases.find((t) => t.description === "LOJA ONLINE AGIL")).toMatchObject({
      amount: -28000n,
      original: { amount: 4861n, currency: "USD" },
    });
    const payment = transactions.find((t) => t.isBillPayment);
    expect(payment).toMatchObject({ amount: 214635n, description: "PAGAMENTO RECEBIDO" });
  });

  it("conta corrente: forma de pagamento pelo banco e entrada positiva", async () => {
    const { provider: p } = provider();
    await p.listAccounts(SYNTHETIC_IDS.itemAurora);
    const { transactions } = await p.listTransactions(SYNTHETIC_IDS.checking, {
      from: "2026-10-01",
      to: TODAY,
    });
    const byDesc = Object.fromEntries(transactions.map((t) => [t.description, t]));
    expect(byDesc["SALARIO EMPRESA EXEMPLO"]).toMatchObject({
      amount: 845000n,
      paymentHint: "TRANSFER",
    });
    expect(byDesc["PIX ENVIADO FULANA"]).toMatchObject({ amount: -12000n, paymentHint: "PIX" });
    expect(byDesc["BOLETO ENERGIA"]).toMatchObject({
      amount: -18990n,
      paymentHint: "BOLETO",
      isBillPayment: false,
    });
  });

  it("o texto da Pluggy chega limpo: sem caractere nulo nem invisível (M12.4a)", async () => {
    const bank = syntheticBank(TODAY);
    const row = bank.transactions.find((t) => t.description === "BOLETO ENERGIA");
    if (!row) throw new Error("o banco sintético mudou");
    row.description = "BOLETO\u0000 ENER\u200bGIA\u202e";
    row.category = "Ser\u0000viços";
    const fake = createFakePluggy(bank);
    const p = new PluggyProvider({
      credentials: SYNTHETIC_CREDENTIALS,
      baseUrl: "http://pluggy.test",
      fetch: fake.fetch,
    });
    await p.listAccounts(SYNTHETIC_IDS.itemAurora);
    const { transactions } = await p.listTransactions(SYNTHETIC_IDS.checking, {
      from: "2026-10-01",
      to: TODAY,
    });
    const boleto = transactions.find((t) => t.description === "BOLETO ENERGIA");
    expect(boleto?.category).toBe("Serviços");
  });

  it("compra em outra moeda sem o valor em reais não entra e é contada", async () => {
    const bank = syntheticBank(TODAY);
    const usd = bank.transactions.find((t) => t.description === "LOJA ONLINE AGIL");
    if (usd) usd.amountInAccountCurrency = null;
    const fake = createFakePluggy(bank);
    const p = new PluggyProvider({
      credentials: SYNTHETIC_CREDENTIALS,
      baseUrl: "http://pluggy.test",
      fetch: fake.fetch,
    });
    await p.listAccounts(SYNTHETIC_IDS.itemAurora);
    const result = await p.listTransactions(SYNTHETIC_IDS.mastercard, {
      from: "2026-10-01",
      to: TODAY,
    });
    expect(result.skipped).toBe(1);
    expect(result.transactions.some((t) => t.description === "LOJA ONLINE AGIL")).toBe(false);
  });
});

describe("PluggyProvider · faturas", () => {
  it("a Bill fechada com IOF e mínimo", async () => {
    const { provider: p } = provider();
    expect(await p.listBills(SYNTHETIC_IDS.mastercard)).toEqual([
      {
        externalId: SYNTHETIC_IDS.septemberBill,
        accountExternalId: SYNTHETIC_IDS.mastercard,
        dueDate: "2026-10-05",
        total: 214635n,
        minimumPayment: 32195n,
        currency: "BRL",
        charges: [{ kind: "IOF", amount: 412n }],
        payments: [],
      },
    ]);
  });
});

describe("PluggyProvider · erros sem vazar segredo", () => {
  it("credenciais recusadas: PROVIDER_AUTH_FAILED, e o Client Secret não aparece no erro", async () => {
    const { provider: p } = provider(
      {},
      { ...SYNTHETIC_CREDENTIALS, clientSecret: "segredo-errado-123" },
    );
    const error = await p.listAccounts(SYNTHETIC_IDS.itemAurora).catch((e: unknown) => e);
    expect(isProviderError(error) && error.code).toBe("PROVIDER_AUTH_FAILED");
    expect(
      JSON.stringify({
        message: String(error),
        detail: isProviderError(error) ? error.detail : "",
      }),
    ).not.toContain("segredo-errado-123");
  });

  it("fora do ar e muitas chamadas viram códigos próprios", async () => {
    await expect(
      provider({ failures: { "/accounts": 503 } }).provider.listAccounts(SYNTHETIC_IDS.itemAurora),
    ).rejects.toMatchObject({
      code: "PROVIDER_UNAVAILABLE",
    });
    await expect(
      provider({ failures: { "/bills": 429 } }).provider.listBills(SYNTHETIC_IDS.mastercard),
    ).rejects.toMatchObject({
      code: "PROVIDER_RATE_LIMITED",
    });
  });

  it("rede caída (fetch lança) vira PROVIDER_UNAVAILABLE sem a URL com parâmetros", async () => {
    const p = new PluggyProvider({
      credentials: SYNTHETIC_CREDENTIALS,
      fetch: async () => {
        throw new Error("getaddrinfo ENOTFOUND api.pluggy.ai?clientSecret=x");
      },
    });
    const error = await p.verifyCredentials().catch((e: unknown) => e);
    expect(isProviderError(error) && error.code).toBe("PROVIDER_UNAVAILABLE");
    expect(isProviderError(error) && error.detail).toBe("POST /auth sem resposta");
  });

  it("chave expirada é renovada uma vez (a Pluggy dá 2 horas)", async () => {
    const fake = createFakePluggy(syntheticBank(TODAY));
    let now = 0;
    const p = new PluggyProvider({
      credentials: SYNTHETIC_CREDENTIALS,
      baseUrl: "http://pluggy.test",
      fetch: fake.fetch,
      now: () => now,
    });
    await p.listAccounts(SYNTHETIC_IDS.itemAurora);
    now += 3 * 60 * 60 * 1000;
    await p.listAccounts(SYNTHETIC_IDS.itemAurora);
    expect(fake.calls.filter((c) => c === "POST /auth")).toHaveLength(2);
  });
});
