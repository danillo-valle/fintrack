// Entrada e saída (M13.3a, ADR-025): o que soma em "Entradas" e o que soma em "Saídas".
//
// Na conta (corrente, poupança, vale, dinheiro), pelo sinal: o que entra é entrada, o que sai é
// saída. No cartão de crédito, tudo é saída, com sinal: a compra aumenta a fatura e o estorno ou o
// cashback a diminuem. Um estorno de R$ 50 no cartão não é "entrada" ao lado do salário; ele abate
// R$ 50 da categoria da compra.
//
// A transferência (e o pagamento da fatura, que é uma) não é nem uma nem outra: quem chama já a
// deixa de fora. A mesma regra está em SQL (FLOW_SQL) e no WHERE da lista (typeWhere), em
// packages/db; o teste de integração confere as três.
import type { Cents } from "./money";
import type { AccountKind } from "./transactions";

export type Flow = "income" | "expense";

export function flowOf(t: { amount: Cents; accountKind: AccountKind }): Flow {
  if (t.accountKind === "CREDIT_CARD") return "expense";
  return t.amount > 0n ? "income" : "expense";
}

/**
 * Quanto o lançamento soma em "Saídas" (positivo = saiu) ou em "Entradas" (positivo = entrou).
 * No cartão, o estorno soma negativo nas saídas.
 */
export function flowAmount(t: { amount: Cents; accountKind: AccountKind }): {
  flow: Flow;
  cents: Cents;
} {
  const flow = flowOf(t);
  return { flow, cents: flow === "expense" ? -t.amount : t.amount };
}
