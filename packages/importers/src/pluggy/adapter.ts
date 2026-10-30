// Adaptador do Meu Pluggy: implementa TransactionProvider com a API da Pluggy e traduz cada
// resposta para o formato do FinTrack (centavos, datas civis, só o final do cartão).
//
//   GET /items/{id}                        o banco e quando o Meu Pluggy o atualizou
//   GET /accounts?itemId=…                 contas do banco (o Meu Pluggy não lista os items)
//   GET /v2/transactions?accountId=…       lançamentos, com cursor (campo "next")
//   GET /bills?accountId=…                 faturas FECHADAS do cartão (a aberta não é uma Bill)
//
// Convenções da Pluggy que importam aqui:
//   - o sinal do valor varia com o tipo de conta; o campo `type` não: DEBIT = saída, CREDIT = entrada;
//   - compra em outra moeda: `amount` vem na moeda original e `amountInAccountCurrency` em reais;
//   - a compra só ganha `billId` quando a fatura dela fecha (até lá, é "fatura aberta");
//   - o pagamento da fatura aparece também dentro da conta do cartão: ele chega pela Bill.
import {
  civilFromProviderTimestamp,
  cleanText,
  lastFourOf,
  type Cents,
  type PaymentHint,
  type StatementChargeKind,
} from "@fintrack/core";
import { moneyFromText, type ExactJson } from "../exact-json";
import {
  ProviderError,
  type DateRange,
  type ProviderAccount,
  type ProviderBill,
  type ProviderItem,
  type ProviderTransaction,
  type TransactionProvider,
} from "../provider";
import { PluggyClient, type PluggyClientOptions } from "./client";

type Obj = { [key: string]: ExactJson };

const isObj = (value: ExactJson | undefined): value is Obj =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Todo texto da Pluggy passa por aqui: limpo (cleanText, M12.4a), aparado, ou nulo se vazio */
const str = (value: ExactJson | undefined): string | null => {
  const text = typeof value === "string" ? cleanText(value).trim() : "";
  return text !== "" ? text : null;
};

function money(value: ExactJson | undefined): Cents | null {
  return typeof value === "string" ? moneyFromText(value) : null;
}

function intOf(value: ExactJson | undefined): number | null {
  if (typeof value !== "string" || !/^\d{1,3}$/.test(value)) return null;
  return Number.parseInt(value, 10);
}

function dateOf(value: ExactJson | undefined) {
  const text = str(value);
  if (!text) return null;
  try {
    return civilFromProviderTimestamp(text);
  } catch {
    return null;
  }
}

/** A lista `results` de uma resposta da Pluggy; formato inesperado é erro (nunca "lista vazia"). */
function resultsOf(body: ExactJson, route: string): Obj[] {
  if (!isObj(body) || !Array.isArray(body.results)) {
    throw new ProviderError("PROVIDER_BAD_RESPONSE", `${route} sem results`);
  }
  return body.results.filter(isObj);
}

const CHARGE_KIND: Record<string, StatementChargeKind> = {
  IOF: "IOF",
  LATE_PAYMENT_INTEREST: "LATE_INTEREST",
  LATE_PAYMENT_FEE: "LATE_FEE",
  LATE_PAYMENT_REMUNERATIVE_INTEREST: "REMUNERATIVE_INTEREST",
};

function paymentHintOf(tx: Obj): PaymentHint {
  const method = isObj(tx.paymentData) ? str(tx.paymentData.paymentMethod) : null;
  const hint = (method ?? str(tx.operationType) ?? "").toUpperCase();
  if (hint.includes("PIX")) return "PIX";
  if (hint.includes("BOLETO")) return "BOLETO";
  if (/\b(TED|DOC|TEF|TRANSFERENCIA)\b/.test(hint)) return "TRANSFER";
  return null;
}

const BILL_PAYMENT_RE = /pagamento\s+(de\s+)?fatura|pagamento\s+recebido|pgto\s+fatura/i;

export class PluggyProvider implements TransactionProvider {
  readonly kind = "PLUGGY" as const;
  private readonly client: PluggyClient;
  /** Tipo e moeda de cada conta já lida (o lançamento não traz o tipo da conta) */
  private readonly accounts = new Map<
    string,
    { kind: ProviderAccount["kind"]; currency: string }
  >();

  constructor(options: PluggyClientOptions) {
    this.client = new PluggyClient(options);
  }

  /** Confere as credenciais (POST /auth) sem buscar dado nenhum. */
  async verifyCredentials(): Promise<void> {
    await this.client.authenticate();
  }

  async getItem(itemExternalId: string): Promise<ProviderItem> {
    const body = await this.client.get(`/items/${encodeURIComponent(itemExternalId)}`);
    if (!isObj(body)) throw new ProviderError("PROVIDER_BAD_RESPONSE", "GET /items sem objeto");
    const connector = isObj(body.connector) ? body.connector : {};
    const updated = str(body.lastUpdatedAt) ?? str(body.updatedAt);
    const updatedAt = updated ? new Date(updated) : null;
    return {
      externalId: str(body.id) ?? itemExternalId,
      institution: str(connector.name),
      updatedAt: updatedAt && !Number.isNaN(updatedAt.getTime()) ? updatedAt : null,
    };
  }

  async listAccounts(itemExternalId: string): Promise<ProviderAccount[]> {
    const body = await this.client.get(`/accounts?itemId=${encodeURIComponent(itemExternalId)}`);
    const accounts: ProviderAccount[] = [];
    for (const raw of resultsOf(body, "GET /accounts")) {
      const externalId = str(raw.id);
      const subtype = str(raw.subtype);
      const type = str(raw.type);
      if (!externalId) continue;
      const kind: ProviderAccount["kind"] | null =
        subtype === "CREDIT_CARD" || type === "CREDIT"
          ? "CREDIT_CARD"
          : subtype === "SAVINGS_ACCOUNT"
            ? "SAVINGS"
            : subtype === "CHECKING_ACCOUNT" || type === "BANK"
              ? "CHECKING"
              : null;
      if (!kind) continue;
      const currency = str(raw.currencyCode) ?? "BRL";
      const credit = isObj(raw.creditData) ? raw.creditData : null;
      const number = str(raw.number);
      accounts.push({
        externalId,
        itemExternalId: str(raw.itemId) ?? itemExternalId,
        kind,
        name: str(raw.marketingName) ?? str(raw.name) ?? "Conta",
        // Cartão: só o final, mesmo que a fonte mande mais
        number: kind === "CREDIT_CARD" ? lastFourOf(number) : number,
        currency,
        balance: kind === "CREDIT_CARD" ? null : money(raw.balance),
        credit:
          kind === "CREDIT_CARD"
            ? {
                limit: credit ? money(credit.creditLimit) : null,
                available: credit ? money(credit.availableCreditLimit) : null,
                closeDate: credit ? dateOf(credit.balanceCloseDate) : null,
                dueDate: credit ? dateOf(credit.balanceDueDate) : null,
                brand: credit ? str(credit.brand) : null,
              }
            : null,
      });
      this.accounts.set(externalId, { kind, currency });
    }
    return accounts;
  }

  async listTransactions(
    accountExternalId: string,
    range: DateRange,
  ): Promise<{ transactions: ProviderTransaction[]; skipped: number }> {
    const account = this.accounts.get(accountExternalId);
    const query = new URLSearchParams({
      accountId: accountExternalId,
      dateFrom: range.from,
      dateTo: range.to,
    });
    let next: string | null = `?${query.toString()}`;
    const transactions: ProviderTransaction[] = [];
    let skipped = 0;
    const seenCursors = new Set<string>();
    while (next) {
      if (seenCursors.has(next))
        throw new ProviderError("PROVIDER_BAD_RESPONSE", "cursor repetido");
      seenCursors.add(next);
      const body = await this.client.get(`/v2/transactions${next}`);
      for (const raw of resultsOf(body, "GET /v2/transactions")) {
        const parsed = this.transactionOf(raw, accountExternalId, account);
        if (parsed === "skip") skipped += 1;
        else if (parsed) transactions.push(parsed);
      }
      const cursor = isObj(body) ? str(body.next) : null;
      // "next" é uma query pronta ("?accountId=…&after=…"); só aceitamos esse formato
      next = cursor && cursor.startsWith("?") ? cursor : null;
    }
    return { transactions, skipped };
  }

  private transactionOf(
    raw: Obj,
    accountExternalId: string,
    account: { kind: ProviderAccount["kind"]; currency: string } | undefined,
  ): ProviderTransaction | "skip" | null {
    const externalId = str(raw.id);
    const occurredOn = dateOf(raw.date);
    const type = str(raw.type);
    if (!externalId || !occurredOn || (type !== "DEBIT" && type !== "CREDIT")) return null;
    const accountCurrency = account?.currency ?? "BRL";
    const currency = str(raw.currencyCode) ?? accountCurrency;
    const amountText = money(raw.amount);
    const inAccountCurrency = money(raw.amountInAccountCurrency);
    const foreign = currency !== accountCurrency;
    const value = foreign ? inAccountCurrency : (inAccountCurrency ?? amountText);
    if (value === null || value === 0n) return foreign ? "skip" : null;
    const abs = value < 0n ? -value : value;
    const amount = type === "DEBIT" ? -abs : abs;
    const card = isObj(raw.creditCardMetadata) ? raw.creditCardMetadata : null;
    const number = card ? intOf(card.installmentNumber) : null;
    const count = card ? intOf(card.totalInstallments) : null;
    const description = str(raw.description) ?? str(raw.descriptionRaw) ?? "";
    const category = str(raw.category);
    const isCard = (account?.kind ?? (card ? "CREDIT_CARD" : "CHECKING")) === "CREDIT_CARD";
    const original =
      foreign && amountText !== null
        ? { amount: amountText < 0n ? -amountText : amountText, currency }
        : null;
    return {
      externalId,
      accountExternalId,
      occurredOn,
      description,
      amount,
      status: str(raw.status) === "PENDING" ? "PENDING" : "POSTED",
      paymentHint: paymentHintOf(raw),
      category: category ? category.slice(0, 100) : null,
      original: original && /^[A-Z]{3}$/.test(original.currency) ? original : null,
      installment:
        number !== null &&
        count !== null &&
        count >= 2 &&
        count <= 99 &&
        number >= 1 &&
        number <= count
          ? { number, count }
          : null,
      cardLastFour: card ? lastFourOf(str(card.cardNumber)) : null,
      billExternalId: card ? str(card.billId) : null,
      isBillPayment:
        isCard &&
        type === "CREDIT" &&
        (str(raw.operationType) === "PAGAMENTO_FATURA" || BILL_PAYMENT_RE.test(description)),
    };
  }

  async listBills(accountExternalId: string): Promise<ProviderBill[]> {
    const body = await this.client.get(`/bills?accountId=${encodeURIComponent(accountExternalId)}`);
    const bills: ProviderBill[] = [];
    for (const raw of resultsOf(body, "GET /bills")) {
      const externalId = str(raw.id);
      const dueDate = dateOf(raw.dueDate);
      const total = money(raw.totalAmount);
      if (!externalId || !dueDate || total === null) continue;
      const charges = Array.isArray(raw.financeCharges) ? raw.financeCharges.filter(isObj) : [];
      const payments = Array.isArray(raw.payments) ? raw.payments.filter(isObj) : [];
      bills.push({
        externalId,
        accountExternalId,
        dueDate,
        total: total < 0n ? -total : total,
        minimumPayment: money(raw.minimumPaymentAmount),
        currency: str(raw.totalAmountCurrencyCode) ?? "BRL",
        charges: charges.flatMap((c) => {
          const amount = money(c.amount);
          if (amount === null || amount === 0n) return [];
          return [
            {
              kind: CHARGE_KIND[str(c.type) ?? ""] ?? "OTHER",
              amount: amount < 0n ? -amount : amount,
            },
          ];
        }),
        payments: payments.flatMap((p) => {
          const amount = money(p.amount);
          const paidOn = dateOf(p.paymentDate);
          if (amount === null || amount === 0n || !paidOn) return [];
          return [{ paidOn, amount: amount < 0n ? -amount : amount }];
        }),
      });
    }
    return bills;
  }
}
