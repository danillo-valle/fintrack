// O "banco sintético": respostas no formato da Pluggy, com dados INVENTADOS (bancos Aurora e
// Exemplo, finais 0001, 0002 e 0003, as compras dos desenhos aprovados na linha E do canvas).
//
// Regra do projeto (proteção de dados): nada de conexão real aqui, nem copiado, nem
// "anonimizado". As datas são relativas a `today`: os testes de integração usam um dia fixo
// (2026-10-10, o dos desenhos) e o E2E usa o dia de hoje, para a fatura aberta continuar aberta.
//
// A versão de 2026-10-10 fica GRAVADA em fixtures/pluggy/ (respostas gravadas): o teste
// synthetic.test.ts confere que o gerador ainda produz exatamente o arquivo gravado.
import { addDays, centsToDecimal, decimalToCents, type CivilDate } from "@fintrack/core";

/** Valor monetário que vira NÚMERO no JSON (como a Pluggy manda), sem passar por float. */
export type Money = { readonly $money: string };
const m = (value: string): Money => ({ $money: value });

type Json = string | number | boolean | null | Money | Json[] | { [key: string]: Json };

export type SyntheticBank = {
  items: Record<string, { [key: string]: Json }>;
  accounts: { [key: string]: Json }[];
  transactions: { [key: string]: Json }[];
  bills: { [key: string]: Json }[];
};

export const SYNTHETIC_IDS = {
  itemAurora: "a1b2c3d4-0000-4000-8000-000000000001",
  itemExemplo: "a1b2c3d4-0000-4000-8000-000000000002",
  checking: "5a1e0001-0000-4000-8000-000000000101",
  mastercard: "5a1e0001-0000-4000-8000-000000000102",
  visa: "5a1e0001-0000-4000-8000-000000000103",
  savings: "5a1e0001-0000-4000-8000-000000000104",
  septemberBill: "b1110000-0000-4000-8000-000000000001",
} as const;

/** Credenciais de mentira que o banco sintético aceita (nunca uma credencial real). */
export const SYNTHETIC_CREDENTIALS = {
  clientId: "0f1e2d3c-0000-4000-8000-00000000c1d0",
  clientSecret: "segredo-sintetico-do-laboratorio",
} as const;

const midnight = (date: CivilDate) => `${date}T00:00:00.000Z`;

/** Banco sintético para o dia `today`. */
export function syntheticBank(today: CivilDate): SyntheticBank {
  const day = (offset: number) => addDays(today, offset);
  const ids = SYNTHETIC_IDS;

  const accounts = [
    {
      id: ids.checking,
      itemId: ids.itemAurora,
      type: "BANK",
      subtype: "CHECKING_ACCOUNT",
      name: "Conta Corrente",
      marketingName: null,
      number: "12345-6",
      balance: m("4218.36"),
      currencyCode: "BRL",
      bankData: { transferNumber: "0001/12345-6", closingBalance: m("4218.36") },
      creditData: null,
    },
    {
      id: ids.mastercard,
      itemId: ids.itemAurora,
      type: "CREDIT",
      subtype: "CREDIT_CARD",
      name: "Mastercard Gold",
      marketingName: null,
      number: "0001",
      balance: m("1284.90"),
      currencyCode: "BRL",
      bankData: null,
      creditData: {
        level: "GOLD",
        brand: "MASTERCARD",
        balanceCloseDate: midnight(day(17)),
        balanceDueDate: midnight(day(26)),
        availableCreditLimit: m("6115.10"),
        creditLimit: m("8000.00"),
        minimumPayment: null,
      },
    },
    {
      id: ids.visa,
      itemId: ids.itemExemplo,
      type: "CREDIT",
      subtype: "CREDIT_CARD",
      name: "Visa Platinum",
      marketingName: null,
      number: "0002",
      balance: m("932.47"),
      currencyCode: "BRL",
      bankData: null,
      creditData: {
        level: "PLATINUM",
        brand: "VISA",
        balanceCloseDate: midnight(day(23)),
        balanceDueDate: midnight(day(31)),
        availableCreditLimit: m("3067.53"),
        creditLimit: m("4000.00"),
        minimumPayment: null,
      },
    },
    {
      id: ids.savings,
      itemId: ids.itemExemplo,
      type: "BANK",
      subtype: "SAVINGS_ACCOUNT",
      name: "Poupança",
      marketingName: null,
      number: "0003",
      balance: m("1500.00"),
      currencyCode: "BRL",
      bankData: null,
      creditData: null,
    },
  ];

  let seq = 0;
  const tx = (input: {
    account: string;
    offset: number;
    description: string;
    amount: string;
    type: "DEBIT" | "CREDIT";
    status?: "PENDING" | "POSTED";
    category?: string | null;
    card?: { [key: string]: Json } | null;
    currencyCode?: string;
    amountInAccountCurrency?: string | null;
    paymentMethod?: string | null;
    operationType?: string | null;
  }) => {
    seq += 1;
    return {
      id: `7e570000-0000-4000-8000-${String(seq).padStart(12, "0")}`,
      accountId: input.account,
      date: midnight(day(input.offset)),
      description: input.description,
      descriptionRaw: null,
      currencyCode: input.currencyCode ?? "BRL",
      amount: m(input.amount),
      amountInAccountCurrency: input.amountInAccountCurrency
        ? m(input.amountInAccountCurrency)
        : null,
      type: input.type,
      status: input.status ?? "POSTED",
      category: input.category ?? null,
      categoryId: null,
      operationType: input.operationType ?? null,
      paymentData: input.paymentMethod ? { paymentMethod: input.paymentMethod } : null,
      creditCardMetadata: input.card ?? null,
    };
  };

  const mc = ids.mastercard;
  const card = (extra: { [key: string]: Json } = {}) => ({ cardNumber: "0001", ...extra });
  const transactions = [
    // Fatura aberta do Mastercard final 0001: as 7 compras dos desenhos (soma R$ 1.284,90)
    tx({
      account: mc,
      offset: -1,
      description: "MERCADO BOM PRECO",
      amount: "312.48",
      type: "DEBIT",
      status: "PENDING",
      category: "Supermercados",
      card: card(),
    }),
    tx({
      account: mc,
      offset: -2,
      description: "POSTO ESTRELA",
      amount: "220.00",
      type: "DEBIT",
      status: "PENDING",
      category: "Postos de gasolina",
      card: card(),
    }),
    tx({
      account: mc,
      offset: -4,
      description: "FARMACIA CENTRAL",
      amount: "89.90",
      type: "DEBIT",
      category: "Farmácia",
      card: card(),
    }),
    tx({
      account: mc,
      offset: -5,
      description: "LIVRARIA NOBRE PARC 03/06",
      amount: "149.90",
      type: "DEBIT",
      category: "Livrarias",
      card: card({ installmentNumber: 3, totalInstallments: 6, purchaseDate: midnight(day(-66)) }),
    }),
    tx({
      account: mc,
      offset: -7,
      description: "STREAMING OMEGA",
      amount: "44.90",
      type: "DEBIT",
      category: "Streaming",
      card: card(),
    }),
    tx({
      account: mc,
      offset: -8,
      description: "RESTAURANTE SABOR",
      amount: "187.72",
      type: "DEBIT",
      category: "Restaurantes",
      card: card(),
    }),
    tx({
      account: mc,
      offset: -9,
      description: "LOJA ONLINE AGIL",
      amount: "48.61",
      currencyCode: "USD",
      amountInAccountCurrency: "280.00",
      type: "DEBIT",
      category: "Compras online",
      card: card(),
    }),
    // Pagamento da fatura de setembro dentro da conta do cartão: chega pela Bill, não vira lançamento
    tx({
      account: mc,
      offset: -7,
      description: "PAGAMENTO RECEBIDO",
      amount: "-2146.35",
      type: "CREDIT",
      operationType: "PAGAMENTO_FATURA",
      card: card(),
    }),
  ];

  // Fatura de setembro (fechada, vence dia 5): 31 compras que somam R$ 2.142,23 + IOF R$ 4,12
  const septemberValues = [
    "52.30",
    "18.90",
    "75.00",
    "120.45",
    "33.10",
    "64.80",
    "12.50",
    "88.00",
    "45.90",
    "29.99",
    "110.00",
    "56.75",
    "23.40",
    "97.10",
    "41.20",
    "68.35",
    "15.00",
    "130.00",
    "37.80",
    "72.60",
    "26.45",
    "84.90",
    "19.99",
    "58.00",
    "47.30",
    "101.25",
    "31.60",
    "66.40",
    "22.10",
    "93.15",
  ];
  const partial = septemberValues.reduce((sum, value) => sum + decimalToCents(value), 0n);
  septemberValues.push(centsToDecimal(214223n - partial)); // a 31ª fecha a soma ao centavo
  septemberValues.forEach((value, index) => {
    transactions.push(
      tx({
        account: mc,
        offset: -43 + index,
        description: `COMPRA SINTETICA ${String(index + 1).padStart(2, "0")}`,
        amount: value,
        type: "DEBIT",
        category: null,
        card: card({ billId: ids.septemberBill }),
      }),
    );
  });

  // Fatura aberta do Visa final 0002 (compras da Casa, soma R$ 932,47)
  const visa = ids.visa;
  const vcard = () => ({ cardNumber: "0002" });
  transactions.push(
    tx({
      account: visa,
      offset: -1,
      description: "SUPERMERCADO CENTRAL",
      amount: "412.30",
      type: "DEBIT",
      category: "Supermercados",
      card: vcard(),
    }),
    tx({
      account: visa,
      offset: -3,
      description: "HORTIFRUTI DA FEIRA",
      amount: "96.17",
      type: "DEBIT",
      category: "Supermercados",
      card: vcard(),
    }),
    tx({
      account: visa,
      offset: -4,
      description: "FARMACIA POPULAR",
      amount: "58.00",
      type: "DEBIT",
      category: "Farmácia",
      card: vcard(),
    }),
    tx({
      account: visa,
      offset: -6,
      description: "PADARIA PAO QUENTE",
      amount: "42.00",
      type: "DEBIT",
      category: "Padarias",
      card: vcard(),
    }),
    tx({
      account: visa,
      offset: -8,
      description: "LOJA DE CASA",
      amount: "324.00",
      type: "DEBIT",
      category: "Casa e decoração",
      card: vcard(),
    }),
  );

  // Conta corrente: salário, Pix, boleto e o pagamento da fatura (a perna da conta corrente)
  const cc = ids.checking;
  transactions.push(
    tx({
      account: cc,
      offset: -5,
      description: "SALARIO EMPRESA EXEMPLO",
      amount: "8450.00",
      type: "CREDIT",
      paymentMethod: "TED",
      category: "Salário",
    }),
    tx({
      account: cc,
      offset: -3,
      description: "PIX ENVIADO FULANA",
      amount: "-120.00",
      type: "DEBIT",
      paymentMethod: "PIX",
      category: "Transferências",
    }),
    tx({
      account: cc,
      offset: -6,
      description: "BOLETO ENERGIA",
      amount: "-189.90",
      type: "DEBIT",
      paymentMethod: "BOLETO",
      category: "Energia",
    }),
    tx({
      account: cc,
      offset: -7,
      description: "PAGAMENTO FATURA CARTAO",
      amount: "-2146.35",
      type: "DEBIT",
      paymentMethod: "BOLETO",
      operationType: "PAGAMENTO_FATURA",
      category: "Pagamento de cartão",
    }),
  );
  // Poupança
  transactions.push(
    tx({
      account: ids.savings,
      offset: -9,
      description: "RENDIMENTO POUPANCA",
      amount: "7.85",
      type: "CREDIT",
      category: "Rendimentos",
    }),
  );

  const bills = [
    {
      id: ids.septemberBill,
      accountId: mc,
      dueDate: midnight(day(-5)),
      totalAmount: m("2146.35"),
      totalAmountCurrencyCode: "BRL",
      minimumPaymentAmount: m("321.95"),
      allowsInstallments: true,
      financeCharges: [
        {
          id: "c0000000-0000-4000-8000-000000000001",
          type: "IOF",
          amount: m("4.12"),
          currencyCode: "BRL",
        },
      ],
      payments: [],
    },
  ];

  const updatedAt = (offsetHoursUtc: number) =>
    `${today}T${String(offsetHoursUtc).padStart(2, "0")}:12:00.000Z`;
  return {
    items: {
      [ids.itemAurora]: {
        id: ids.itemAurora,
        status: "UPDATED",
        connector: { id: 9001, name: "Banco Aurora" },
        lastUpdatedAt: updatedAt(8),
      },
      [ids.itemExemplo]: {
        id: ids.itemExemplo,
        status: "UPDATED",
        connector: { id: 9002, name: "Banco Exemplo" },
        lastUpdatedAt: updatedAt(8),
      },
    },
    accounts,
    transactions,
    bills,
  };
}

/** JSON como a Pluggy manda: os valores monetários saem como números, com 2 casas exatas. */
export function toPluggyJson(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) =>
    v && typeof v === "object" && "$money" in v ? `__money__${(v as Money).$money}` : v,
  ).replace(/"__money__(-?\d+\.\d{2})"/g, "$1");
}
