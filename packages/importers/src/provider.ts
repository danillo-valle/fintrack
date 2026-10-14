// A interface que toda fonte de dados bancários implementa (M09, ADR-011). Cada fonte é um
// ADAPTADOR: o Meu Pluggy agora (M09.1), o arquivo OFX (M09.3) e o PDF da fatura (M09.4) depois.
// Quem sincroniza (@fintrack/db, sync.ts) conversa só com esta interface e nunca sabe de qual
// fonte o dado veio. Trocar ou acrescentar uma fonte é escrever um adaptador, não mexer no resto.
//
// Tudo aqui já chega NORMALIZADO para as regras do FinTrack:
//   dinheiro  bigint em centavos (Cents), com sinal: negativo = saiu dinheiro
//   datas     data civil "AAAA-MM-DD" (sem hora, sem fuso)
//   cartão    só os 4 últimos dígitos, nunca o número inteiro
import type { Cents, CivilDate, PaymentHint, StatementChargeKind } from "@fintrack/core";

/** Um banco conectado (no Meu Pluggy: um "item"). */
export type ProviderItem = {
  externalId: string;
  /** Nome do banco, como a fonte informa */
  institution: string | null;
  /** Quando a fonte atualizou os dados deste banco pela última vez */
  updatedAt: Date | null;
};

/** Uma conta do banco: corrente, poupança ou cartão de crédito. */
export type ProviderAccount = {
  externalId: string;
  itemExternalId: string;
  kind: "CHECKING" | "SAVINGS" | "CREDIT_CARD";
  name: string;
  /** Número da conta (corrente) ou os 4 últimos dígitos (cartão), como a fonte devolve */
  number: string | null;
  /** Moeda da conta (ISO 4217) */
  currency: string;
  /** Saldo da conta corrente ou poupança; nulo em cartão */
  balance: Cents | null;
  /** Dados do cartão; nulo nas outras contas */
  credit: {
    limit: Cents | null;
    available: Cents | null;
    closeDate: CivilDate | null;
    dueDate: CivilDate | null;
    brand: string | null;
  } | null;
};

/** Um lançamento como o banco informa. */
export type ProviderTransaction = {
  externalId: string;
  accountExternalId: string;
  occurredOn: CivilDate;
  description: string;
  /** Em reais (moeda da conta), com sinal: negativo = saída */
  amount: Cents;
  /** PENDING = o banco ainda pode mudar; POSTED = lançado */
  status: "PENDING" | "POSTED";
  /** O que o banco diz sobre a forma de pagamento */
  paymentHint: PaymentHint;
  /** A categoria que o banco devolve (texto livre do provedor) */
  category: string | null;
  /** Compra em outra moeda: o valor original (positivo) e a moeda */
  original: { amount: Cents; currency: string } | null;
  /** "3 de 6" numa compra parcelada */
  installment: { number: number; count: number } | null;
  /** Final do cartão usado (adicional ou virtual podem ter final diferente da conta) */
  cardLastFour: string | null;
  /** A fatura em que a compra entrou (só depois que a fatura fecha) */
  billExternalId: string | null;
  /** Pagamento da fatura dentro da conta do cartão: chega pela Bill, não vira lançamento */
  isBillPayment: boolean;
};

/** Uma fatura fechada do cartão (no Open Finance, a entidade Bill). */
export type ProviderBill = {
  externalId: string;
  accountExternalId: string;
  dueDate: CivilDate;
  /** Total a pagar (positivo) */
  total: Cents;
  minimumPayment: Cents | null;
  currency: string;
  charges: { kind: StatementChargeKind; amount: Cents }[];
  payments: { paidOn: CivilDate; amount: Cents }[];
};

/** O período pedido ao banco, com as duas pontas incluídas. */
export type DateRange = { from: CivilDate; to: CivilDate };

/**
 * A fonte de dados. Toda chamada pode lançar ProviderError (nunca a resposta crua da fonte, que
 * pode ter dado pessoal, e nunca a credencial).
 */
export interface TransactionProvider {
  readonly kind: "PLUGGY";
  getItem(itemExternalId: string): Promise<ProviderItem>;
  listAccounts(itemExternalId: string): Promise<ProviderAccount[]>;
  /**
   * Os lançamentos do período. `skipped` conta os que não puderam virar lançamento (compra em
   * outra moeda sem o valor em reais): a sincronização registra o número no SyncRun.
   */
  listTransactions(
    accountExternalId: string,
    range: DateRange,
  ): Promise<{ transactions: ProviderTransaction[]; skipped: number }>;
  listBills(accountExternalId: string): Promise<ProviderBill[]>;
}

/**
 * Os erros que a fonte pode dar, com um código que a tela traduz e que vai para o SyncRun.
 *   PROVIDER_AUTH_FAILED    Client ID ou Client Secret recusados
 *   PROVIDER_NOT_FOUND      o item ou a conta não existe para estas credenciais
 *   PROVIDER_RATE_LIMITED   muitas chamadas; tentar mais tarde
 *   PROVIDER_UNAVAILABLE    fora do ar, tempo esgotado, rede
 *   PROVIDER_BAD_RESPONSE   a resposta não tem o formato esperado
 */
export type ProviderErrorCode =
  | "PROVIDER_AUTH_FAILED"
  | "PROVIDER_NOT_FOUND"
  | "PROVIDER_RATE_LIMITED"
  | "PROVIDER_UNAVAILABLE"
  | "PROVIDER_BAD_RESPONSE";

export class ProviderError extends Error {
  constructor(
    readonly code: ProviderErrorCode,
    /** Detalhe técnico SEM dado pessoal nem segredo (ex.: "GET /accounts → 503") */
    readonly detail: string = "",
  ) {
    super(code);
    this.name = "ProviderError";
  }
}

export function isProviderError(error: unknown): error is ProviderError {
  return error instanceof ProviderError;
}
