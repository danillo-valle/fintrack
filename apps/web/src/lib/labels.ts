// Nomes em português do que o código chama em inglês (M07): formas de pagamento, tipos de
// conta, quem categorizou, recorrências e cartões. Record<tipo, texto>: valor novo sem frase
// aqui vira erro de compilação. Sem banco: serve à tela do servidor e à do navegador.
import type {
  AccountKind,
  CategorizationSource,
  PaymentMethod,
  TransactionKind,
} from "@fintrack/core";

export const METHOD_LABEL: Record<PaymentMethod, string> = {
  CREDIT: "Crédito",
  DEBIT: "Débito",
  PIX: "PIX",
  BOLETO: "Boleto",
  TRANSFER: "Transferência",
  DEPOSIT: "Depósito",
  CASH: "Dinheiro",
  WITHDRAWAL: "Saque",
  VOUCHER: "Vale",
};

export const ACCOUNT_KIND_LABEL: Record<AccountKind, string> = {
  CHECKING: "Conta corrente",
  SAVINGS: "Poupança",
  CREDIT_CARD: "Cartão de crédito",
  MEAL_VOUCHER: "Vale-refeição",
  CASH: "Dinheiro",
};

export const KIND_LABEL: Record<TransactionKind, string> = {
  expense: "Despesa",
  income: "Receita",
};

/** "Quem categorizou", como aparece no detalhe do lançamento. */
export const CATEGORIZED_BY_LABEL: Record<CategorizationSource, string> = {
  MANUAL: "você escolheu",
  RULE: "sugerida por uma regra",
  HISTORY: "sugerida pelo histórico",
};

export const RECURRENCE_KIND_LABEL = {
  FIXED_BILL: "Conta fixa",
  SUBSCRIPTION: "Assinatura",
  INCOME: "Receita",
} as const;

export const CARD_FORM_LABEL = {
  PHYSICAL: "Físico",
  VIRTUAL: "Virtual",
  VIRTUAL_TEMPORARY: "Virtual temporário",
} as const;

export const STATUS_LABEL = {
  PENDING: "A revisar",
  SCHEDULED: "Agendado",
  CONFIRMED: "Confirmado",
} as const;
