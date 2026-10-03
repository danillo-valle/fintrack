// O PLANO do seed: um grupo fictício com 24 meses de vida financeira, montado só em memória.
//
// Esta função é PURA: recebe o mês final, o dia de hoje e uma semente, e devolve listas de
// objetos. Não fala com o banco (quem grava é o write.ts). Por isso o plano tem testes
// próprios, rápidos, que conferem as regras: parcelas que somam o total, faturas que batem
// com as compras, transferências que se anulam, forma de pagamento que combina com a conta.
//
// A estrutura imita a de uma casa real (a planilha que deu origem ao FinTrack), com nomes,
// valores e cartões inventados:
//
//   Lia (pessoal) ─ Conta Lia, Poupança Lia
//                 └ Cartão Master (titular Lia, fecha 3, vence 9)
//                     ├ final 1001 físico      Lia
//                     ├ final 1002 virtual     Lia   (assinaturas)
//                     ├ final 1003 físico adic. Caio  (mercado da Casa, como o "CASAL")
//                     └ final 1004 virtual adic. Caio (academia do Caio)
//   Caio (pessoal) ─ Conta Caio, Vale Caio (vale-refeição, cartão 4001)
//                 └ Cartão Visa (titular Caio, fecha 25, vence 5) ─ 2001 físico, 2002 virtual
//   Casa (compartilhado, Lia e Caio)
//                 ─ Conta da Casa, Dinheiro
//                 └ Cartão da Casa (o cartão CONJUNTO: titular Lia, fecha 10, vence 17)
//                     ├ final 3001 físico       Lia
//                     └ final 3002 físico adic. Caio
//
// Tudo que é dinheiro aqui é bigint em centavos, e toda conta usa o @fintrack/core.
import {
  addDays,
  addMonths,
  addMonthsToKey,
  allocate,
  compareCivil,
  dayOfMonth,
  decimalToCents,
  firstDayOf,
  installmentPlan,
  parseMonthKey,
  statementFor,
  statementOfMonth,
  sumCents,
  type CardCycle,
  type Cents,
  type CivilDate,
  type MonthKey,
} from "@fintrack/core";
import { createRandom, type Random } from "./random";

// ── Tipos do plano (espelham as tabelas, com dinheiro em centavos e datas civis) ──────────

export type PaymentMethod =
  | "CREDIT"
  | "DEBIT"
  | "PIX"
  | "BOLETO"
  | "TRANSFER"
  | "DEPOSIT"
  | "CASH"
  | "WITHDRAWAL"
  | "VOUCHER";

export type SeedUser = { id: string; name: string; email: string };
export type SeedWallet = {
  id: string;
  name: string;
  kind: "PERSONAL" | "SHARED";
  createdById: string;
  members: { userId: string; role: "OWNER" | "EDITOR" | "VIEWER" }[];
};
export type SeedAccount = {
  id: string;
  walletId: string;
  holderId: string | null;
  name: string;
  kind: "CHECKING" | "SAVINGS" | "CREDIT_CARD" | "MEAL_VOUCHER" | "CASH";
  institution: string | null;
  initialBalance: Cents;
  creditLimit: Cents | null;
  cycle: CardCycle | null;
};
export type SeedCard = {
  id: string;
  accountId: string;
  holderId: string;
  nickname: string;
  brand: string;
  lastFour: string;
  form: "PHYSICAL" | "VIRTUAL" | "VIRTUAL_TEMPORARY";
  isAdditional: boolean;
};
export type SeedCategory = {
  id: string;
  name: string;
  kind: "EXPENSE" | "INCOME";
  parentId: string | null;
  color: string | null;
};
export type SeedRule = {
  id: string;
  categoryId: string;
  pattern: string;
  match: "CONTAINS" | "STARTS_WITH" | "EQUALS";
  priority: number;
};
export type SeedBudget = {
  id: string;
  walletId: string;
  categoryId: string;
  month: MonthKey;
  amount: Cents;
};
export type SeedRecurrence = {
  id: string;
  walletId: string;
  accountId: string;
  cardId: string | null;
  categoryId: string | null;
  kind: "FIXED_BILL" | "SUBSCRIPTION" | "INCOME";
  method: PaymentMethod;
  description: string;
  amount: Cents;
  dayOfMonth: number;
  startsOn: CivilDate;
  createdById: string;
};
export type SeedStatement = {
  id: string;
  accountId: string;
  referenceMonth: MonthKey;
  closingDate: CivilDate;
  dueDate: CivilDate;
  total: Cents | null;
  status: "OPEN" | "CLOSED" | "PAID";
};
export type SeedInstallmentGroup = {
  id: string;
  walletId: string;
  accountId: string;
  description: string;
  totalAmount: Cents;
  installmentCount: number;
  purchasedOn: CivilDate;
};
export type SeedTransaction = {
  id: string;
  walletId: string;
  accountId: string;
  cardId: string | null;
  method: PaymentMethod;
  categoryId: string | null;
  amount: Cents;
  occurredOn: CivilDate;
  description: string;
  status: "PENDING" | "SCHEDULED" | "CONFIRMED";
  source: "MANUAL" | "OPEN_FINANCE" | "RECURRENCE";
  externalId: string | null;
  statementId: string | null;
  installmentGroupId: string | null;
  installmentNumber: number | null;
  recurrenceId: string | null;
  transferId: string | null;
  reversalOfId: string | null;
  createdById: string | null;
};
export type SeedPlan = {
  household: { id: string; name: string };
  users: SeedUser[];
  wallets: SeedWallet[];
  accounts: SeedAccount[];
  cards: SeedCard[];
  categories: SeedCategory[];
  rules: SeedRule[];
  budgets: SeedBudget[];
  recurrences: SeedRecurrence[];
  statements: SeedStatement[];
  installmentGroups: SeedInstallmentGroup[];
  transactions: SeedTransaction[];
};

export type SeedOptions = {
  /** Último mês do histórico ("2026-10"). Normalmente, o mês de hoje. */
  endMonth: MonthKey;
  /** Hoje. Depois de hoje só existem parcelas futuras e lançamentos agendados (SCHEDULED). */
  today: CivilDate;
  /** Quantos meses de histórico (padrão: 24). */
  months?: number;
  /** Semente do gerador aleatório (padrão: 2026). Mesma semente, mesmos dados. */
  seed?: number;
};

// ── Identificadores ───────────────────────────────────────────────────────────

/** Id fixo do grupo do seed: é por ele que o seed apaga a versão anterior antes de gravar. */
export const SEED_HOUSEHOLD_ID = "5eed0000-0000-4000-8000-000000000000";
/** Ids fixos das duas pessoas fictícias (texto, como os ids do Better Auth). */
export const SEED_USER_IDS = ["seed-lia", "seed-caio"] as const;

/**
 * Gera ids no formato UUID, em sequência e começando por "5eed": dá para reconhecer no banco
 * o que veio do seed, e nunca colide com os UUID v7 do app (que começam pela data).
 */
function idFactory() {
  let counter = 0;
  return () => {
    counter += 1;
    return `5eed0000-0000-4000-8000-${counter.toString(16).padStart(12, "0")}`;
  };
}

/**
 * R$ em centavos, escrito como texto para ler bem no código: brl("-129.90") = -12990n.
 * Usa a conversão testada do @fintrack/core. (Uma versão própria, que separava "-129" e "90",
 * dava -12810n: o centavo somava com o sinal errado. O plan.test.ts agora pega isso.)
 */
const brl = (value: string): Cents => decimalToCents(value);

// ── O plano ───────────────────────────────────────────────────────────────────

export function buildSeedPlan(options: SeedOptions): SeedPlan {
  const months = options.months ?? 24;
  const rng: Random = createRandom(options.seed ?? 2026);
  const newId = idFactory();
  const { today } = options;
  const firstMonth = addMonthsToKey(options.endMonth, -(months - 1));
  const isFuture = (date: CivilDate) => compareCivil(date, today) > 0;

  // ── Pessoas e ambientes ─────────────────────────────────────────────────────
  const [liaId, caioId] = SEED_USER_IDS;
  const users: SeedUser[] = [
    { id: liaId, name: "Lia Exemplo", email: "lia@exemplo.test" },
    { id: caioId, name: "Caio Exemplo", email: "caio@exemplo.test" },
  ];
  const personal = (userId: string, name: string): SeedWallet => ({
    id: newId(),
    name,
    kind: "PERSONAL",
    createdById: userId,
    members: [{ userId, role: "OWNER" }],
  });
  const lia = personal(liaId, "Lia");
  const caio = personal(caioId, "Caio");
  const home: SeedWallet = {
    id: newId(),
    name: "Casa",
    kind: "SHARED",
    createdById: liaId,
    members: [
      { userId: liaId, role: "OWNER" },
      { userId: caioId, role: "OWNER" },
    ],
  };
  const wallets = [lia, caio, home];

  // ── Contas e cartões ────────────────────────────────────────────────────────
  const account = (
    wallet: SeedWallet,
    holderId: string | null,
    name: string,
    kind: SeedAccount["kind"],
    extra: Partial<SeedAccount> = {},
  ): SeedAccount => ({
    id: newId(),
    walletId: wallet.id,
    holderId,
    name,
    kind,
    institution:
      kind === "CASH" ? null : kind === "MEAL_VOUCHER" ? "Vale Exemplo" : "Banco Exemplo",
    initialBalance: 0n,
    creditLimit: null,
    cycle: null,
    ...extra,
  });
  const liaChecking = account(lia, liaId, "Conta Lia", "CHECKING", {
    initialBalance: brl("2500.00"),
  });
  const liaSavings = account(lia, liaId, "Poupança Lia", "SAVINGS", {
    initialBalance: brl("5000.00"),
  });
  const master = account(lia, liaId, "Cartão Master", "CREDIT_CARD", {
    creditLimit: brl("15000.00"),
    cycle: { closingDay: 3, dueDay: 9 },
  });
  const caioChecking = account(caio, caioId, "Conta Caio", "CHECKING", {
    initialBalance: brl("1800.00"),
  });
  const visa = account(caio, caioId, "Cartão Visa", "CREDIT_CARD", {
    creditLimit: brl("8000.00"),
    cycle: { closingDay: 25, dueDay: 5 },
  });
  const voucher = account(caio, caioId, "Vale Caio", "MEAL_VOUCHER");
  const homeChecking = account(home, liaId, "Conta da Casa", "CHECKING", {
    initialBalance: brl("1200.00"),
  });
  const homeCash = account(home, null, "Dinheiro", "CASH", { initialBalance: brl("150.00") });
  const homeCard = account(home, liaId, "Cartão da Casa", "CREDIT_CARD", {
    creditLimit: brl("10000.00"),
    cycle: { closingDay: 10, dueDay: 17 },
  });
  const accounts = [
    liaChecking,
    liaSavings,
    master,
    caioChecking,
    visa,
    voucher,
    homeChecking,
    homeCash,
    homeCard,
  ];

  const card = (
    acc: SeedAccount,
    holderId: string,
    lastFour: string,
    form: SeedCard["form"],
    isAdditional: boolean,
    brand: string,
  ): SeedCard => ({
    id: newId(),
    accountId: acc.id,
    holderId,
    nickname: `${brand} ${lastFour}`,
    brand,
    lastFour,
    form,
    isAdditional,
  });
  const m1001 = card(master, liaId, "1001", "PHYSICAL", false, "Mastercard");
  const m1002 = card(master, liaId, "1002", "VIRTUAL", false, "Mastercard");
  const m1003 = card(master, caioId, "1003", "PHYSICAL", true, "Mastercard");
  const m1004 = card(master, caioId, "1004", "VIRTUAL", true, "Mastercard");
  const v2001 = card(visa, caioId, "2001", "PHYSICAL", false, "Visa");
  const v2002 = card(visa, caioId, "2002", "VIRTUAL", false, "Visa");
  const h3001 = card(homeCard, liaId, "3001", "PHYSICAL", false, "Elo");
  const h3002 = card(homeCard, caioId, "3002", "PHYSICAL", true, "Elo");
  const vale4001 = card(voucher, caioId, "4001", "PHYSICAL", false, "Vale Exemplo");
  const cards = [m1001, m1002, m1003, m1004, v2001, v2002, h3001, h3002, vale4001];
  const accountOf = (c: SeedCard): SeedAccount => {
    const acc = accounts.find((a) => a.id === c.accountId);
    if (!acc) throw new Error(`Cartão sem conta: ${c.nickname}`);
    return acc;
  };

  // ── Categorias (pai › filhas), no formato da planilha ───────────────────────
  const categories: SeedCategory[] = [];
  const cat: Record<string, string> = {};
  const addCategory = (
    name: string,
    kind: SeedCategory["kind"],
    parent: string | null,
    color: string | null,
  ) => {
    const id = newId();
    categories.push({ id, name, kind, parentId: parent ? (cat[parent] ?? null) : null, color });
    cat[name] = id;
  };
  const tree: [string, string, string[]][] = [
    [
      "Alimentação",
      "chart-2",
      ["Mercado", "Feira Livre", "Restaurante", "Delivery", "Panificadora", "Almoço"],
    ],
    [
      "Moradia",
      "chart-1",
      ["Aluguel", "Condomínio", "Energia", "Água", "Internet Residencial", "Diarista"],
    ],
    [
      "Transporte",
      "chart-3",
      [
        "Combustível",
        "Aplicativo",
        "Estacionamento",
        "Manutenção do Carro",
        "Financiamento do Carro",
      ],
    ],
    ["Saúde", "chart-4", ["Farmácia", "Plano de Saúde", "Academia"]],
    ["Assinaturas", "chart-5", ["Streaming", "Assinatura Online"]],
    ["Lazer", "chart-5", ["Passeios", "Viagem"]],
    ["Vestuário", "chart-1", ["Roupas"]],
    ["Educação", "chart-2", ["Cursos"]],
    ["Compras", "chart-3", ["Eletrônicos", "Eletrodomésticos", "Presentes"]],
  ];
  for (const [parent, color, children] of tree) {
    addCategory(parent, "EXPENSE", null, color);
    for (const child of children) addCategory(child, "EXPENSE", parent, color);
  }
  for (const income of ["Salário", "13º Salário", "Rendimentos", "Vale-refeição"])
    addCategory(income, "INCOME", null, null);
  const categoryId = (name: string): string => {
    const id = cat[name];
    if (!id) throw new Error(`Categoria do seed não existe: ${name}`);
    return id;
  };

  // Regras texto → categoria (o padrão fica em minúsculas, sem acento: o CHECK do banco exige)
  const rules: SeedRule[] = [
    ["ifood", "Delivery"],
    ["uber", "Aplicativo"],
    ["netflix", "Streaming"],
    ["spotify", "Streaming"],
    ["posto", "Combustível"],
    ["drogaria", "Farmácia"],
    ["supermercado", "Mercado"],
    ["padaria", "Panificadora"],
  ].map(([pattern = "", name = ""], index) => ({
    id: newId(),
    categoryId: categoryId(name),
    pattern,
    match: "CONTAINS" as const,
    priority: 100 + index,
  }));

  // ── Recorrências: as antigas abas "Despesas Fixas" e "Recorrentes" ──────────
  const recurrences: SeedRecurrence[] = [];
  const recurring = (
    kind: SeedRecurrence["kind"],
    wallet: SeedWallet,
    acc: SeedAccount,
    c: SeedCard | null,
    method: PaymentMethod,
    description: string,
    amount: Cents,
    day: number,
    category: string | null,
    createdById: string,
  ): SeedRecurrence => {
    const r: SeedRecurrence = {
      id: newId(),
      walletId: wallet.id,
      accountId: acc.id,
      cardId: c?.id ?? null,
      categoryId: category ? categoryId(category) : null,
      kind,
      method,
      description,
      amount,
      dayOfMonth: day,
      startsOn: firstDayOf(firstMonth),
      createdById,
    };
    recurrences.push(r);
    return r;
  };
  const R = {
    salaryLia: recurring(
      "INCOME",
      lia,
      liaChecking,
      null,
      "TRANSFER",
      "Salário Empresa Alfa",
      brl("7800.00"),
      5,
      "Salário",
      liaId,
    ),
    salaryCaio: recurring(
      "INCOME",
      caio,
      caioChecking,
      null,
      "TRANSFER",
      "Salário Empresa Beta",
      brl("6200.00"),
      5,
      "Salário",
      caioId,
    ),
    voucher: recurring(
      "INCOME",
      caio,
      voucher,
      null,
      "DEPOSIT",
      "Recarga do vale",
      brl("600.00"),
      1,
      "Vale-refeição",
      caioId,
    ),
    rent: recurring(
      "FIXED_BILL",
      home,
      homeChecking,
      null,
      "BOLETO",
      "Aluguel Imobiliária Lar",
      brl("-2800.00"),
      10,
      "Aluguel",
      liaId,
    ),
    condo: recurring(
      "FIXED_BILL",
      home,
      homeChecking,
      null,
      "BOLETO",
      "Condomínio Edifício Exemplo",
      brl("-650.00"),
      10,
      "Condomínio",
      liaId,
    ),
    power: recurring(
      "FIXED_BILL",
      home,
      homeChecking,
      null,
      "DEBIT",
      "Companhia de Energia",
      brl("-260.00"),
      15,
      "Energia",
      liaId,
    ),
    water: recurring(
      "FIXED_BILL",
      home,
      homeChecking,
      null,
      "DEBIT",
      "Companhia de Água",
      brl("-110.00"),
      16,
      "Água",
      liaId,
    ),
    internet: recurring(
      "FIXED_BILL",
      home,
      homeChecking,
      null,
      "DEBIT",
      "Internet Fibra Rápida",
      brl("-119.90"),
      18,
      "Internet Residencial",
      liaId,
    ),
    cleaner: recurring(
      "FIXED_BILL",
      home,
      homeChecking,
      null,
      "PIX",
      "Diarista Maria",
      brl("-360.00"),
      23,
      "Diarista",
      liaId,
    ),
    healthLia: recurring(
      "FIXED_BILL",
      lia,
      liaChecking,
      null,
      "DEBIT",
      "Plano de Saúde Vida",
      brl("-520.00"),
      8,
      "Plano de Saúde",
      liaId,
    ),
    healthCaio: recurring(
      "FIXED_BILL",
      caio,
      caioChecking,
      null,
      "DEBIT",
      "Plano de Saúde Vida",
      brl("-460.00"),
      8,
      "Plano de Saúde",
      caioId,
    ),
    carLoan: recurring(
      "FIXED_BILL",
      caio,
      caioChecking,
      null,
      "DEBIT",
      "Financiamento Veículo Banco Exemplo",
      brl("-1150.00"),
      12,
      "Financiamento do Carro",
      caioId,
    ),
    netflix: recurring(
      "SUBSCRIPTION",
      home,
      master,
      m1002,
      "CREDIT",
      "NETFLIX.COM",
      brl("-55.90"),
      12,
      "Streaming",
      liaId,
    ),
    spotify: recurring(
      "SUBSCRIPTION",
      caio,
      visa,
      v2002,
      "CREDIT",
      "SPOTIFY",
      brl("-21.90"),
      15,
      "Streaming",
      caioId,
    ),
    gymLia: recurring(
      "SUBSCRIPTION",
      lia,
      master,
      m1002,
      "CREDIT",
      "Academia Corpo em Forma",
      brl("-129.90"),
      6,
      "Academia",
      liaId,
    ),
    // A academia do Caio sai no virtual ADICIONAL dele, na fatura da Lia, mas é gasto do Caio
    gymCaio: recurring(
      "SUBSCRIPTION",
      caio,
      master,
      m1004,
      "CREDIT",
      "Academia Corpo em Forma",
      brl("-129.90"),
      6,
      "Academia",
      caioId,
    ),
    cloud: recurring(
      "SUBSCRIPTION",
      lia,
      master,
      m1002,
      "CREDIT",
      "Armazenamento Nuvem",
      brl("-14.90"),
      20,
      "Assinatura Online",
      liaId,
    ),
  };

  // ── Lançamentos ─────────────────────────────────────────────────────────────
  const transactions: SeedTransaction[] = [];
  const installmentGroups: SeedInstallmentGroup[] = [];
  const statementsByKey = new Map<string, SeedStatement>();
  let externalCounter = 0;

  function statementForMonth(acc: SeedAccount, referenceMonth: MonthKey): SeedStatement {
    if (!acc.cycle) throw new Error(`${acc.name} não é cartão`);
    const key = `${acc.id}:${referenceMonth}`;
    let statement = statementsByKey.get(key);
    if (!statement) {
      statement = {
        id: newId(),
        accountId: acc.id,
        ...statementOfMonth(referenceMonth, acc.cycle),
        total: null,
        status: "OPEN",
      };
      statementsByKey.set(key, statement);
    }
    return statement;
  }
  function statementIdFor(acc: SeedAccount, date: CivilDate): string | null {
    if (!acc.cycle) return null;
    return statementForMonth(acc, statementFor(date, acc.cycle).referenceMonth).id;
  }
  const methodFor = (acc: SeedAccount): PaymentMethod =>
    acc.kind === "CREDIT_CARD"
      ? "CREDIT"
      : acc.kind === "MEAL_VOUCHER"
        ? "VOUCHER"
        : acc.kind === "CASH"
          ? "CASH"
          : "DEBIT";

  function base(
    acc: SeedAccount,
    wallet: SeedWallet,
    date: CivilDate,
    amount: Cents,
    description: string,
  ): SeedTransaction {
    return {
      id: newId(),
      walletId: wallet.id,
      accountId: acc.id,
      cardId: null,
      method: methodFor(acc),
      categoryId: null,
      amount,
      occurredOn: date,
      description,
      status: "CONFIRMED",
      source: "MANUAL",
      externalId: null,
      statementId: null,
      installmentGroupId: null,
      installmentNumber: null,
      recurrenceId: null,
      transferId: null,
      reversalOfId: null,
      createdById: acc.holderId,
    };
  }

  /**
   * Compra com cartão: QUEM PAGA é a conta do cartão; DE QUEM É, o ambiente passado.
   * Cartão de crédito entra como importado (Open Finance), com a fatura certa.
   */
  function buy(
    c: SeedCard,
    wallet: SeedWallet,
    date: CivilDate,
    amount: Cents,
    description: string,
    category: string,
    extra: Partial<SeedTransaction> = {},
  ) {
    if (isFuture(date)) return null;
    const acc = accountOf(c);
    const imported = acc.kind === "CREDIT_CARD";
    if (imported) externalCounter += 1;
    const recent = compareCivil(addDays(date, 5), today) >= 0; // últimos 5 dias: revisar
    const row: SeedTransaction = {
      ...base(acc, wallet, date, amount, description),
      cardId: c.id,
      categoryId: categoryId(category),
      status: imported && recent ? "PENDING" : "CONFIRMED",
      source: imported ? "OPEN_FINANCE" : "MANUAL",
      externalId: imported ? `seed-of-${externalCounter}` : null,
      statementId: statementIdFor(acc, date),
      createdById: imported ? null : c.holderId,
      ...extra,
    };
    transactions.push(row);
    return row;
  }

  /** Lançamento sem cartão (dinheiro, PIX, débito em conta). */
  function pay(
    acc: SeedAccount,
    wallet: SeedWallet,
    date: CivilDate,
    amount: Cents,
    description: string,
    category: string,
    method?: PaymentMethod,
  ) {
    if (isFuture(date)) return;
    transactions.push({
      ...base(acc, wallet, date, amount, description),
      method: method ?? methodFor(acc),
      categoryId: categoryId(category),
    });
  }

  /** Ocorrência de uma recorrência no mês: CONFIRMED se já passou, SCHEDULED se ainda vai acontecer. */
  function occur(r: SeedRecurrence, month: MonthKey, amount: Cents = r.amount) {
    const date = dayOfMonth(month, r.dayOfMonth);
    if (compareCivil(date, dayOfMonth(options.endMonth, 31)) > 0) return; // só até o fim do mês de hoje
    const acc = accounts.find((a) => a.id === r.accountId);
    const wallet = wallets.find((w) => w.id === r.walletId);
    if (!acc || !wallet) throw new Error(`Recorrência inconsistente: ${r.description}`);
    transactions.push({
      ...base(acc, wallet, date, amount, r.description),
      cardId: r.cardId,
      method: r.method,
      categoryId: r.categoryId,
      status: isFuture(date) ? "SCHEDULED" : "CONFIRMED",
      source: "RECURRENCE",
      externalId: `${r.id}:${month}`,
      statementId: statementIdFor(acc, date),
      recurrenceId: r.id,
      createdById: null,
    });
  }

  /** Transferência: dois lançamentos com o mesmo transferId, que se anulam na soma. */
  function transfer(
    from: SeedAccount,
    to: SeedAccount,
    date: CivilDate,
    amount: Cents,
    description: string,
    method: PaymentMethod = "PIX",
  ) {
    if (isFuture(date)) return;
    const transferId = newId();
    const walletOf = (acc: SeedAccount) => wallets.find((w) => w.id === acc.walletId) ?? home;
    transactions.push(
      { ...base(from, walletOf(from), date, -amount, description), method, transferId },
      { ...base(to, walletOf(to), date, amount, description), method, transferId },
    );
  }

  /** Compra parcelada no cartão: o grupo e um lançamento por parcela, cada um na sua fatura. */
  function installmentPurchase(
    c: SeedCard,
    wallet: SeedWallet,
    purchasedOn: CivilDate,
    total: Cents,
    count: number,
    description: string,
    category: string,
  ) {
    const acc = accountOf(c);
    if (!acc.cycle || isFuture(purchasedOn)) return;
    const group: SeedInstallmentGroup = {
      id: newId(),
      walletId: wallet.id,
      accountId: acc.id,
      description,
      totalAmount: -total,
      installmentCount: count,
      purchasedOn,
    };
    installmentGroups.push(group);
    for (const parcel of installmentPlan({ total: -total, count, purchasedOn, cycle: acc.cycle })) {
      externalCounter += 1;
      transactions.push({
        ...base(
          acc,
          wallet,
          addMonths(purchasedOn, parcel.number - 1),
          parcel.amount,
          `${description} ${parcel.number}/${count}`,
        ),
        cardId: c.id,
        method: "CREDIT",
        categoryId: categoryId(category),
        source: "OPEN_FINANCE",
        externalId: `seed-of-${externalCounter}`,
        statementId: statementForMonth(acc, parcel.referenceMonth).id,
        installmentGroupId: group.id,
        installmentNumber: parcel.number,
        createdById: null,
      });
    }
  }

  const RESTAURANTS = [
    "Restaurante Sabor Caseiro",
    "Pizzaria Forno a Lenha",
    "Café da Praça",
    "Sushi do Bairro",
  ];
  const MARKETS = ["Supermercado Bom Preço", "Supermercado Vila Nova", "Mercado da Esquina"];
  const CLOTHES = ["Loja Vestir Bem", "Calçados Passo Firme", "Loja Estilo Urbano"];
  const TRIPS = [
    "Hotel Serra Azul",
    "Pousada Beira-Mar",
    "Passeio de barco",
    "Ingresso Parque das Águas",
  ];
  const GIFTS = ["Livraria Página Nova", "Loja de Presentes Laço", "Brinquedos Alegria"];
  const LUNCH = ["Restaurante Prato Feito", "Self-service Sabor", "Lanchonete Central"];

  let liaSalary = R.salaryLia.amount;
  let caioSalary = R.salaryCaio.amount;
  let savingsBalance = liaSavings.initialBalance;

  for (let index = 0; index < months; index += 1) {
    const month = addMonthsToKey(firstMonth, index);
    const { month: calendarMonth } = parseMonthKey(month);
    const day = (d: number) => dayOfMonth(month, d);
    const summer = calendarMonth === 12 || calendarMonth <= 3;
    const raise = index >= 12 ? 106n : 100n; // reajuste de 6% no segundo ano
    if (index === 12) {
      liaSalary = (liaSalary * 106n) / 100n;
      caioSalary = (caioSalary * 106n) / 100n;
    }

    // Receitas recorrentes (salário com reajuste; 13º em dezembro)
    occur(R.salaryLia, month, liaSalary);
    occur(R.salaryCaio, month, caioSalary);
    occur(R.voucher, month);
    if (calendarMonth === 12) {
      pay(
        liaChecking,
        lia,
        day(20),
        liaSalary,
        "13º salário Empresa Alfa",
        "13º Salário",
        "TRANSFER",
      );
      pay(
        caioChecking,
        caio,
        day(20),
        caioSalary,
        "13º salário Empresa Beta",
        "13º Salário",
        "TRANSFER",
      );
    }

    // Rendimento da poupança (0,55% ao mês, em bigint) e o depósito mensal
    if (!isFuture(day(1))) {
      const interest = (savingsBalance * 55n) / 10000n;
      if (interest > 0n) {
        pay(liaSavings, lia, day(1), interest, "Rendimento da poupança", "Rendimentos", "DEPOSIT");
        savingsBalance += interest;
      }
    }
    if (!isFuture(day(7))) {
      transfer(liaChecking, liaSavings, day(7), brl("1500.00"), "Guardar na poupança");
      savingsBalance += brl("1500.00");
    }

    // Contribuição para a Conta da Casa, proporcional ao salário (rateio do @fintrack/core)
    const [fromLia = 0n, fromCaio = 0n] = allocate(index < 12 ? brl("6450.00") : brl("6750.00"), [
      liaSalary,
      caioSalary,
    ]);
    transfer(liaChecking, homeChecking, day(6), fromLia, "Contribuição para a casa");
    transfer(caioChecking, homeChecking, day(6), fromCaio, "Contribuição para a casa");

    // Contas fixas (recorrências); energia e água variam com o mês
    occur(R.rent, month, (R.rent.amount * raise) / 100n);
    occur(R.condo, month);
    occur(
      R.power,
      month,
      -rng.cents(summer ? brl("310.00") : brl("190.00"), summer ? brl("420.00") : brl("260.00")),
    );
    occur(R.water, month, -rng.cents(brl("85.00"), brl("140.00")));
    occur(R.internet, month);
    occur(R.cleaner, month);
    occur(R.healthLia, month, (R.healthLia.amount * raise) / 100n);
    occur(R.healthCaio, month, (R.healthCaio.amount * raise) / 100n);
    occur(R.carLoan, month);
    // Assinaturas nos cartões virtuais
    occur(R.netflix, month, index >= 12 ? brl("-59.90") : R.netflix.amount);
    occur(R.spotify, month);
    occur(R.gymLia, month);
    occur(R.gymCaio, month);
    occur(R.cloud, month);

    // Mercado toda semana, gasto da Casa: no cartão conjunto ou no adicional do Caio na
    // fatura da Lia (o "CASAL" da planilha). Dezembro é mais caro.
    for (const d of [3, 10, 17, 24]) {
      const value =
        (rng.cents(brl("240.00"), brl("470.00")) * (calendarMonth === 12 ? 130n : 100n)) / 100n;
      buy(rng.pick([h3001, h3002, m1003]), home, day(d), -value, rng.pick(MARKETS), "Mercado");
    }
    // Feira no sábado, em dinheiro; saque para repor
    transfer(homeChecking, homeCash, day(2), brl("250.00"), "Saque para a feira", "WITHDRAWAL");
    for (const d of [6, 13, 20, 27])
      pay(
        homeCash,
        home,
        day(d),
        -rng.cents(brl("38.00"), brl("85.00")),
        "Feira do bairro",
        "Feira Livre",
      );
    // Padaria do fim de semana, no PIX da Conta da Casa
    for (const d of [7, 21])
      pay(
        homeChecking,
        home,
        day(d),
        -rng.cents(brl("18.00"), brl("45.00")),
        "Padaria Pão Quente",
        "Panificadora",
        "PIX",
      );

    // Jantar a dois (Casa) no cartão conjunto; restaurantes e delivery da Lia no físico dela
    for (let i = 0; i < rng.int(1, 3); i += 1)
      buy(
        h3001,
        home,
        day(rng.int(1, 28)),
        -rng.cents(brl("90.00"), brl("240.00")),
        rng.pick(RESTAURANTS),
        "Restaurante",
      );
    for (let i = 0; i < rng.int(2, 4); i += 1)
      buy(
        m1001,
        lia,
        day(rng.int(1, 28)),
        -rng.cents(brl("38.00"), brl("120.00")),
        rng.pick(RESTAURANTS),
        "Restaurante",
      );
    for (let i = 0; i < rng.int(2, 4); i += 1)
      buy(
        m1001,
        lia,
        day(rng.int(1, 28)),
        -rng.cents(brl("32.00"), brl("95.00")),
        "IFOOD *Lanchonete",
        "Delivery",
      );
    for (let i = 0; i < rng.int(4, 8); i += 1)
      buy(
        m1001,
        lia,
        day(rng.int(1, 28)),
        -rng.cents(brl("12.00"), brl("48.00")),
        "UBER *Viagem",
        "Aplicativo",
      );
    if (rng.chance(0.6))
      pay(
        liaChecking,
        lia,
        day(rng.int(1, 28)),
        -rng.cents(brl("25.00"), brl("180.00")),
        "Drogaria Saúde",
        "Farmácia",
        "PIX",
      );
    if (rng.chance(0.4))
      buy(
        m1001,
        lia,
        day(rng.int(1, 28)),
        -rng.cents(brl("89.90"), brl("420.00")),
        rng.pick(CLOTHES),
        "Roupas",
      );

    // Caio: combustível e estacionamento no Visa, almoço no vale
    for (let i = 0; i < rng.int(3, 4); i += 1)
      buy(
        v2001,
        caio,
        day(rng.int(1, 28)),
        -rng.cents(brl("150.00"), brl("260.00")),
        "Posto Avenida",
        "Combustível",
      );
    for (let i = 0; i < rng.int(1, 3); i += 1)
      buy(
        v2001,
        caio,
        day(rng.int(1, 28)),
        -rng.cents(brl("12.00"), brl("35.00")),
        "Estacionamento Centro",
        "Estacionamento",
      );
    for (let d = 2; d <= 27; d += rng.int(1, 3))
      buy(
        vale4001,
        caio,
        day(d),
        -rng.cents(brl("28.00"), brl("52.00")),
        rng.pick(LUNCH),
        "Almoço",
      );

    // Sazonalidade: férias do casal em janeiro e julho (Casa, no conjunto); presentes em dezembro
    if (calendarMonth === 1 || calendarMonth === 7) {
      for (let i = 0; i < rng.int(2, 4); i += 1)
        buy(
          h3001,
          home,
          day(rng.int(5, 25)),
          -rng.cents(brl("180.00"), brl("950.00")),
          rng.pick(TRIPS),
          rng.pick(["Viagem", "Passeios"]),
        );
    }
    if (calendarMonth === 12) {
      for (let i = 0; i < rng.int(3, 5); i += 1) {
        const [c, w] = rng.pick([
          [m1001, lia],
          [v2001, caio],
        ] as const);
        buy(
          c,
          w,
          day(rng.int(1, 22)),
          -rng.cents(brl("60.00"), brl("380.00")),
          rng.pick(GIFTS),
          "Presentes",
        );
      }
    }

    // Estorno a cada 4 meses: roupa devolvida, reembolsada 3 dias depois no mesmo cartão
    if (index % 4 === 2) {
      const purchase = buy(
        m1001,
        lia,
        day(8),
        -rng.cents(brl("120.00"), brl("300.00")),
        rng.pick(CLOTHES),
        "Roupas",
      );
      const refundOn = addDays(day(8), 3);
      if (purchase && !isFuture(refundOn)) {
        buy(m1001, lia, refundOn, -purchase.amount, `Estorno ${purchase.description}`, "Roupas", {
          reversalOfId: purchase.id,
        });
      }
    }

    // Compras parceladas (as parcelas futuras ficam lançadas: são compromissos já assumidos)
    const purchases: Record<number, () => void> = {
      2: () =>
        installmentPurchase(
          m1001,
          lia,
          day(14),
          brl("4799.90"),
          10,
          "Notebook Loja Tech",
          "Eletrônicos",
        ),
      7: () =>
        installmentPurchase(
          h3001,
          home,
          day(20),
          brl("3599.00"),
          12,
          "Geladeira Casa & Cia",
          "Eletrodomésticos",
        ),
      10: () =>
        installmentPurchase(h3001, home, day(9), brl("2400.00"), 6, "Passagens Voa Bem", "Viagem"),
      15: () =>
        installmentPurchase(
          v2001,
          caio,
          day(4),
          brl("1200.00"),
          3,
          "Curso de inglês Fala Já",
          "Cursos",
        ),
      18: () =>
        installmentPurchase(
          m1001,
          lia,
          day(22),
          brl("2999.00"),
          12,
          "Celular Loja Tech",
          "Eletrônicos",
        ),
      20: () =>
        installmentPurchase(
          v2001,
          caio,
          day(11),
          brl("1680.00"),
          4,
          "Pneus Auto Center",
          "Manutenção do Carro",
        ),
      22: () =>
        installmentPurchase(h3002, home, day(9), brl("2600.00"), 6, "Passagens Voa Bem", "Viagem"),
    };
    purchases[index]?.();
  }

  // ── Faturas: totais e pagamentos ────────────────────────────────────────────
  // Total da fatura = soma das compras e estornos dela, com o sinal invertido (positivo = a pagar).
  // Fatura vencida até hoje: PAGA, com uma transferência da conta corrente do titular para a
  // conta do cartão. O Cartão da Casa é pago pela Conta da Casa.
  const payer = new Map<string, SeedAccount>([
    [master.id, liaChecking],
    [visa.id, caioChecking],
    [homeCard.id, homeChecking],
  ]);
  const statements = [...statementsByKey.values()].sort((a, b) =>
    a.accountId === b.accountId
      ? compareCivil(a.closingDate, b.closingDate)
      : a.accountId < b.accountId
        ? -1
        : 1,
  );
  for (const statement of statements) {
    if (isFuture(statement.closingDate)) continue; // ainda aberta: sem total
    const total = -sumCents(
      transactions
        .filter((t) => t.statementId === statement.id && t.status !== "SCHEDULED")
        .map((t) => t.amount),
    );
    statement.total = total;
    if (isFuture(statement.dueDate)) {
      statement.status = "CLOSED";
      continue;
    }
    statement.status = "PAID";
    const from = payer.get(statement.accountId);
    const cardAccount = accounts.find((a) => a.id === statement.accountId);
    if (from && cardAccount && total > 0n) {
      transfer(
        from,
        cardAccount,
        statement.dueDate,
        total,
        `Pagamento fatura ${cardAccount.name}`,
        "BOLETO",
      );
    }
  }

  // ── Orçamento mensal por ambiente (sobe 5% no segundo ano) ──────────────────
  const budgetPlan: [SeedWallet, string, string][] = [
    [home, "Mercado", "1700.00"],
    [home, "Feira Livre", "260.00"],
    [home, "Restaurante", "400.00"],
    [home, "Energia", "320.00"],
    [home, "Água", "130.00"],
    [home, "Diarista", "360.00"],
    [lia, "Restaurante", "350.00"],
    [lia, "Delivery", "250.00"],
    [lia, "Aplicativo", "200.00"],
    [caio, "Combustível", "750.00"],
    [caio, "Almoço", "900.00"],
  ];
  const budgets: SeedBudget[] = [];
  for (let index = 0; index < months; index += 1) {
    const month = addMonthsToKey(firstMonth, index);
    for (const [wallet, name, value] of budgetPlan) {
      const amount = brl(value);
      budgets.push({
        id: newId(),
        walletId: wallet.id,
        categoryId: categoryId(name),
        month,
        amount: index < 12 ? amount : (amount * 105n) / 100n,
      });
    }
  }

  return {
    household: { id: SEED_HOUSEHOLD_ID, name: "Família Exemplo" },
    users,
    wallets,
    accounts,
    cards,
    categories,
    rules,
    budgets,
    recurrences,
    statements,
    installmentGroups,
    transactions,
  };
}
