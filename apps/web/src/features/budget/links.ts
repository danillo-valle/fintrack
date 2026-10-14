// O caminho de cada número do painel até os lançamentos (M08, "nenhum número sem caminho").
//
// Todo número do Início, do Orçamento, do Fluxo de caixa e da Evolução é um link para
// /lancamentos com os MESMOS filtros que o produziram. A URL é montada pelo filtersToQuery da
// lista (o mesmo que a lista usa para ler), então o painel e a lista nunca discordam sobre o que
// cada parâmetro quer dizer. O E2E de consistência abre cada link e compara os totais.
import {
  dayOfMonth,
  firstDayOf,
  payerParam,
  statementOfMonth,
  addMonthsToKey,
  addDays,
  monthOf,
  type CardCycle,
  type CivilDate,
  type MonthKey,
  type PayerFilter,
} from "@fintrack/core";
import { filtersToQuery, type TransactionTypeFilter } from "../transactions/schemas";

export type ListLink = {
  from: CivilDate;
  to: CivilDate;
  walletId?: string | null;
  /** Categoria (vale com as de baixo) ou "none" para sem categoria */
  categoryId?: string | "none" | null;
  accountId?: string | null;
  payer?: PayerFilter | string | null;
  type?: TransactionTypeFilter | null;
  /** A tela de onde se veio (a lista mostra "Voltar para Orçamento · Mercado") */
  back?: string | null;
};

/** O endereço da lista de lançamentos com os filtros pedidos. */
export function transactionsHref(link: ListLink): string {
  const payer =
    typeof link.payer === "string"
      ? link.payer === "compartilhado"
        ? ({ kind: "shared" } as const)
        : ({ kind: "person", userId: link.payer } as const)
      : (link.payer ?? null);
  return `/lancamentos?${filtersToQuery({
    walletId: link.walletId ?? null,
    filters: {
      from: link.from,
      to: link.to,
      accountId: link.accountId ?? null,
      categoryId: link.categoryId ?? null,
      text: null,
      type: link.type ?? null,
      payer,
      // O painel soma só o que foi conferido: a lista que ele abre é a mesma (sem os recebidos)
      received: false,
    },
    back: link.back ?? null,
  })}`;
}

/** Do dia 1 ao último dia do mês. */
export function monthSpan(month: MonthKey): { from: CivilDate; to: CivilDate } {
  return { from: firstDayOf(month), to: dayOfMonth(month, 31) };
}

/** Do dia 1 até hoje (o "gasto até hoje" do mês em andamento). */
export function monthToDate(month: MonthKey, today: CivilDate): { from: CivilDate; to: CivilDate } {
  const span = monthSpan(month);
  return monthOf(today) === month ? { from: span.from, to: today } : span;
}

/** Vários meses seguidos, do dia 1 do primeiro ao último dia do último (a média de 6 meses). */
export function monthsSpan(first: MonthKey, last: MonthKey): { from: CivilDate; to: CivilDate } {
  return { from: firstDayOf(first), to: dayOfMonth(last, 31) };
}

/**
 * As compras de uma fatura que vence no mês `dueMonth`: do fechamento anterior até a véspera do
 * fechamento dela (a mesma regra do statementFor do core). É o caminho do "Faturas" do fluxo de
 * caixa até a lista: conta + período da fatura.
 */
export function statementSpan(
  dueMonth: MonthKey,
  cycle: CardCycle,
): { from: CivilDate; to: CivilDate; reference: MonthKey } | null {
  // A fatura que vence em dueMonth é a do próprio mês (vence depois de fechar no mesmo mês) ou
  // a do mês anterior (fecha 25, vence 5)
  for (const reference of [dueMonth, addMonthsToKey(dueMonth, -1)]) {
    const statement = statementOfMonth(reference, cycle);
    if (monthOf(statement.dueDate) !== dueMonth) continue;
    const previous = statementOfMonth(addMonthsToKey(reference, -1), cycle);
    return {
      from: previous.closingDate,
      to: addDays(statement.closingDate, -1),
      reference,
    };
  }
  return null;
}

/** O valor do filtro "Pago por" como texto da URL (para comparar). */
export const payerKey = (payer: PayerFilter | null): string | null =>
  payer ? payerParam(payer) : null;
