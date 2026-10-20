// Nomes em português do que o código chama em inglês (M07): formas de pagamento, tipos de
// conta, quem categorizou, recorrências, cartões e encargos da fatura. Record<tipo, texto>: valor novo sem frase
// aqui vira erro de compilação. Sem banco: serve à tela do servidor e à do navegador.
import type {
  AccountKind,
  CategorizationSource,
  PaymentMethod,
  StatementChargeKind,
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
  PROVIDER: "sugerida pela categoria do banco",
  CLASSIFIER: "sugerida pelo classificador",
  LLM: "sugerida pela IA local",
};

/**
 * Quem sugeriu, numa palavra (M10.1, linha F do canvas): a etiqueta das listas e a tela de
 * Ajustes › Categorização. "Banco" é a categoria do Meu Pluggy; "Você", a escolha da pessoa.
 */
export const SOURCE_LABEL: Record<CategorizationSource, string> = {
  RULE: "Regra",
  HISTORY: "Histórico",
  PROVIDER: "Banco",
  CLASSIFIER: "Classificador",
  LLM: "IA local",
  MANUAL: "Você",
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

/** Encargos da fatura do cartão (M09.1; a fatura em PDF, M09.4). */
export const CHARGE_LABEL: Record<StatementChargeKind, string> = {
  IOF: "IOF",
  LATE_INTEREST: "Juros de mora",
  LATE_FEE: "Multa",
  REMUNERATIVE_INTEREST: "Juros do rotativo",
  OTHER: "Outros encargos",
};
