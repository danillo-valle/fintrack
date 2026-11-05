// O saldo de uma conta (M13.3a, ADR-025): o "Saldo hoje" e o "Saldo em 1º de novembro" de
// Lançamentos, o "Na conta hoje" e o "Guardado" do Início.
//
// Numa conta ligada ao banco, o saldo de hoje é o que o banco informa (ele já conta tudo, até o
// que ainda não foi conferido). Numa conta manual, é o saldo inicial mais todos os lançamentos
// até hoje. O saldo no começo de um período é o de hoje menos o que se mexeu desde então: TODOS os
// lançamentos da conta, inclusive transferências, pagamentos de fatura e recebidos (o dinheiro
// saiu da conta de qualquer jeito). O que vem depois de hoje (agendado) não entra.
import type { Cents } from "./money";

export type BalanceInput = {
  /** O saldo que o banco informou (conta ligada), ou null */
  bank: Cents | null;
  /** O saldo do dia em que a conta começou a ser acompanhada (conta manual) */
  initial: Cents;
  /** A soma de todos os lançamentos da conta até hoje */
  upToToday: Cents;
  /** A soma dos lançamentos do começo do período até hoje */
  sinceStart: Cents;
};

export type Balance = {
  /** De onde vem o saldo de hoje */
  source: "bank" | "computed";
  today: Cents;
  /** O saldo antes do primeiro dia do período */
  atStart: Cents;
  /** O que mudou no período (até hoje) */
  change: Cents;
};

export function accountBalance(input: BalanceInput): Balance {
  const today = input.bank ?? input.initial + input.upToToday;
  return {
    source: input.bank === null ? "computed" : "bank",
    today,
    atStart: today - input.sinceStart,
    change: input.sinceStart,
  };
}
