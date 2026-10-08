// Lançamentos (M07): as regras puras do lançamento rápido, da transferência, da lista e das
// recorrências. Sem banco: o @fintrack/db grava, o app mostra, e as regras moram aqui.
import { absCents, MAX_ABS_CENTS, type Cents } from "./money";
import {
  addMonthsToKey,
  compareCivil,
  dayOfMonth,
  isCivilDate,
  monthOf,
  parseMonthKey,
  type CivilDate,
  type MonthKey,
} from "./dates";

// ── Tipo e valor ────────────────────────────────────────────────────────────────

/** Despesa sai (valor negativo no banco); receita entra (positivo). */
export type TransactionKind = "expense" | "income";

/**
 * O valor que vai para o banco: a pessoa digita sempre positivo, o tipo decide o sinal.
 * Zero e valores além da coluna NUMERIC(14,2) são recusados (o banco também recusa zero).
 */
export function signedAmount(kind: TransactionKind, cents: Cents): Cents {
  if (cents <= 0n) throw new Error("O valor do lançamento precisa ser maior que zero.");
  if (cents > MAX_ABS_CENTS) throw new Error("Valor grande demais.");
  return kind === "expense" ? -cents : cents;
}

/** O contrário: do valor com sinal para o que a tela mostra no formulário. */
export function kindAndAbs(amount: Cents): { kind: TransactionKind; cents: Cents } {
  return { kind: amount < 0n ? "expense" : "income", cents: absCents(amount) };
}

// ── Forma de pagamento × tipo de conta ──────────────────────────────────────────

export type AccountKind = "CHECKING" | "SAVINGS" | "CREDIT_CARD" | "MEAL_VOUCHER" | "CASH";
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

export const PAYMENT_METHODS: readonly PaymentMethod[] = [
  "CREDIT",
  "DEBIT",
  "PIX",
  "BOLETO",
  "TRANSFER",
  "DEPOSIT",
  "CASH",
  "WITHDRAWAL",
  "VOUCHER",
];
export const ACCOUNT_KINDS: readonly AccountKind[] = [
  "CHECKING",
  "SAVINGS",
  "CREDIT_CARD",
  "MEAL_VOUCHER",
  "CASH",
];

/**
 * Formas de pagamento que a conta aceita num lançamento comum (fora de transferência).
 * É a MESMA regra do gatilho transaction_method_matches_account do banco (M04); um teste de
 * integração confere as 45 combinações contra o gatilho de verdade, para as duas não divergirem.
 */
export function allowedMethods(account: AccountKind): readonly PaymentMethod[] {
  switch (account) {
    case "CREDIT_CARD":
      return ["CREDIT"];
    case "MEAL_VOUCHER":
      return ["VOUCHER", "DEPOSIT"];
    default:
      return PAYMENT_METHODS.filter((m) => m !== "CREDIT" && m !== "VOUCHER");
  }
}

/** A forma de pagamento que o lançamento rápido escolhe sozinho (a pessoa pode trocar). */
export function defaultMethod(account: AccountKind, kind: TransactionKind): PaymentMethod {
  switch (account) {
    case "CREDIT_CARD":
      return "CREDIT";
    case "MEAL_VOUCHER":
      return kind === "expense" ? "VOUCHER" : "DEPOSIT";
    case "CASH":
      return "CASH";
    default:
      return "PIX";
  }
}

/** Com cartão escolhido, só crédito, débito ou vale (CHECK transaction_card_method_check). */
export function methodAllowsCard(method: PaymentMethod): boolean {
  return method === "CREDIT" || method === "DEBIT" || method === "VOUCHER";
}

// ── Transferência ───────────────────────────────────────────────────────────────

/**
 * Formas de uma transferência (inclusive o pagamento da fatura). Crédito e vale ficam de fora:
 * o gatilho do banco recusa crédito fora do cartão e vale fora do vale-refeição.
 */
export const TRANSFER_METHODS: readonly PaymentMethod[] = [
  "TRANSFER",
  "PIX",
  "BOLETO",
  "WITHDRAWAL",
];

export type TransferLeg = { accountId: string; amount: Cents };

/**
 * Os dois lados de uma transferência (ou do pagamento da fatura): sai de uma conta, entra na
 * outra, mesmo valor, mesmo transferId. Somados, dão zero; por isso não contam como gasto.
 */
export function transferLegs(input: {
  fromAccountId: string;
  toAccountId: string;
  cents: Cents;
}): [TransferLeg, TransferLeg] {
  if (input.fromAccountId === input.toAccountId) {
    throw new Error("Escolha duas contas diferentes.");
  }
  const amount = signedAmount("income", input.cents);
  return [
    { accountId: input.fromAccountId, amount: -amount },
    { accountId: input.toAccountId, amount },
  ];
}

// ── Totais da lista ─────────────────────────────────────────────────────────────

export type TotalsRow = { amount: Cents; transferId: string | null };
export type Totals = { income: Cents; expense: Cents; net: Cents; count: number };

/**
 * Os totais que a lista mostra no topo. Entradas e saídas ignoram transferências (dinheiro
 * que só mudou de conta); `count` conta todas as linhas do filtro. O banco calcula o mesmo
 * em SQL (sumTransactions); um teste confere que os dois batem ao centavo.
 */
export function totalsOf(rows: Iterable<TotalsRow>): Totals {
  let income = 0n;
  let expense = 0n;
  let count = 0;
  for (const row of rows) {
    count += 1;
    if (row.transferId !== null) continue;
    if (row.amount > 0n) income += row.amount;
    else expense += row.amount;
  }
  return { income, expense, net: income + expense, count };
}

// ── Paginação por cursor ────────────────────────────────────────────────────────

/**
 * A lista vem do mais recente para o mais antigo: (occurredOn DESC, id DESC). O cursor é o
 * último item da página: a próxima página começa logo depois dele. Diferente de "página 3"
 * (OFFSET), o cursor não pula nem repete itens quando alguém lança algo no meio da leitura,
 * e não fica mais lento nas páginas do fim.
 */
export type ListCursor = { occurredOn: CivilDate; id: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function encodeCursor(cursor: ListCursor): string {
  return `${cursor.occurredOn}_${cursor.id}`;
}

/** Cursor da URL: qualquer coisa fora do formato vira null (a lista recomeça do topo). */
export function decodeCursor(value: string | null | undefined): ListCursor | null {
  if (!value) return null;
  const [occurredOn, id, extra] = value.split("_");
  if (extra !== undefined || !occurredOn || !id) return null;
  if (!isCivilDate(occurredOn) || !UUID.test(id)) return null;
  return { occurredOn, id: id.toLowerCase() };
}

/** Ordem da lista, para quem precisar ordenar em memória (testes, M08). */
export function compareListOrder(a: ListCursor, b: ListCursor): number {
  return compareCivil(b.occurredOn, a.occurredOn) || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0);
}

// ── Recorrências ────────────────────────────────────────────────────────────────

export type RecurrenceLike = {
  id: string;
  dayOfMonth: number;
  startsOn: CivilDate;
  endsOn: CivilDate | null;
};

/**
 * O dia em que a recorrência cai no mês, ou null se o mês está fora do período dela.
 * Dia 31 em fevereiro cai no último dia (28 ou 29), como o boleto de verdade.
 */
export function occurrenceIn(recurrence: RecurrenceLike, month: MonthKey): CivilDate | null {
  parseMonthKey(month);
  const date = dayOfMonth(month, recurrence.dayOfMonth);
  if (compareCivil(date, recurrence.startsOn) < 0) return null;
  if (recurrence.endsOn && compareCivil(date, recurrence.endsOn) > 0) return null;
  return date;
}

/**
 * O externalId do lançamento que a recorrência gera no mês: "<id da recorrência>:<AAAA-MM>".
 * Com a chave única (accountId, source, externalId) do M04, gerar o mesmo mês duas vezes não
 * duplica: a segunda tentativa encontra a primeira e não cria nada.
 */
export function recurrenceExternalId(recurrenceId: string, month: MonthKey): string {
  parseMonthKey(month);
  return `${recurrenceId}:${month}`;
}

/** Os meses de `from` até `to` (inclusive), para gerar recorrências de um intervalo. */
export function monthsBetween(from: MonthKey, to: MonthKey): MonthKey[] {
  const months: MonthKey[] = [];
  for (let m = from; m <= to && months.length < 120; m = addMonthsToKey(m, 1)) months.push(m);
  return months;
}

/** Período padrão da lista: o mês da data de hoje, do dia 1 ao último dia. */
export function monthRange(today: CivilDate): { from: CivilDate; to: CivilDate } {
  const month = monthOf(today);
  return { from: dayOfMonth(month, 1), to: dayOfMonth(month, 31) };
}
