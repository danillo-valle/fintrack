// A data de caixa e a entrada/saída (M13.3a, ADR-025), escritas uma vez para o banco.
//
// Data de caixa: o dia em que o dinheiro se mexe na conta. Toda compra no cartão tem fatura (o
// gatilho transaction_card_statement), e a data de caixa dela é o vencimento da fatura; o resto é
// o próprio dia. É por ela que a lista, os totais, o painel, o orçamento, o fluxo de caixa e a
// evolução decidem em que mês um lançamento conta. Não é coluna: calcula-se (ADR-004).
//
// Entrada e saída: a regra flowOf do @fintrack/core. Na conta, pelo sinal; no cartão, tudo é
// saída (o estorno abate). O teste de integração "faturas" confere o SQL, o WHERE e o core.
import {
  dayOfMonth,
  dbDateFromCivil,
  firstDayOf,
  type DateRange,
  type MonthKey,
} from "@fintrack/core";
import { Prisma } from "./generated/prisma/client";

/** Os dias de um mês como período: "2026-11" → 01/11 a 30/11. */
export function monthAsRange(month: MonthKey): DateRange {
  return { from: firstDayOf(month), to: dayOfMonth(month, 31) };
}

/**
 * A data de caixa em SQL. "t" é o lançamento e "s" a fatura (LEFT JOIN "card_statement" s ON
 * s."id" = t."statementId"); a transferência não tem fatura e fica no próprio dia.
 */
export const CASH_ON_SQL = Prisma.sql`COALESCE(s."dueDate", t."occurredOn")`;

/** O JOIN que CASH_ON_SQL e FLOW_SQL pedem ("t" lançamento, "a" conta, "s" fatura). */
export const CASH_JOINS_SQL = Prisma.sql`
  JOIN "financial_account" a ON a."id" = t."accountId"
  LEFT JOIN "card_statement" s ON s."id" = t."statementId"`;

/** Saída (positivo = saiu) de um lançamento, pela regra flowOf. Fora da saída: 0. */
export const EXPENSE_SQL = Prisma.sql`CASE
    WHEN a."kind" = 'CREDIT_CARD' THEN -t."amount"
    WHEN t."amount" < 0 THEN -t."amount"
    ELSE 0
  END`;

/** Entrada (positivo = entrou), pela regra flowOf: só nas contas que não são cartão. */
export const INCOME_SQL = Prisma.sql`CASE
    WHEN a."kind" <> 'CREDIT_CARD' AND t."amount" > 0 THEN t."amount"
    ELSE 0
  END`;

/** O WHERE da data de caixa num período (o mesmo que CASH_ON_SQL, no Prisma). */
export function cashOnWhere(range: DateRange): Prisma.TransactionWhereInput {
  const days = { gte: dbDateFromCivil(range.from), lte: dbDateFromCivil(range.to) };
  return {
    OR: [{ statementId: null, occurredOn: days }, { statement: { is: { dueDate: days } } }],
  };
}

/** O WHERE de vários períodos (os meses marcados no combo do Período): qualquer um deles. */
export function cashOnInAny(ranges: readonly DateRange[]): Prisma.TransactionWhereInput {
  if (ranges.length === 1) return cashOnWhere(ranges[0] as DateRange);
  return { OR: ranges.map(cashOnWhere) };
}

/** O dia do lançamento em algum dos períodos (os recebidos: a fila é pelo dia que o banco mandou). */
export function occurredOnInAny(ranges: readonly DateRange[]): Prisma.TransactionWhereInput {
  return {
    OR: ranges.map((r) => ({
      occurredOn: { gte: dbDateFromCivil(r.from), lte: dbDateFromCivil(r.to) },
    })),
  };
}

/** Saída pela regra flowOf, no Prisma (sem a transferência: quem chama decide). */
export const EXPENSE_WHERE: Prisma.TransactionWhereInput = {
  OR: [{ account: { is: { kind: "CREDIT_CARD" } } }, { amount: { lt: 0 } }],
};

/** Entrada pela regra flowOf, no Prisma. */
export const INCOME_WHERE: Prisma.TransactionWhereInput = {
  account: { is: { kind: { not: "CREDIT_CARD" } } },
  amount: { gt: 0 },
};
