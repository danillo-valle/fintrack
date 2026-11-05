// O caminho de cada número do painel até os lançamentos (M08, "nenhum número sem caminho").
//
// Todo número do Início, do Orçamento, do Fluxo de caixa e da Evolução é um link para
// /lancamentos com os MESMOS filtros que o produziram. A URL é montada pelo filtersToQuery da
// lista (o mesmo que a lista usa para ler), então o painel e a lista nunca discordam sobre o que
// cada parâmetro quer dizer. O E2E de consistência abre cada link e compara os totais.
import {
  dayOfMonth,
  firstDayOf,
  parsePayerParam,
  payerParam,
  monthOf,
  type CivilDate,
  type MonthKey,
  type PayerFilter,
} from "@fintrack/core";
import { filtersToQuery, type TransactionTypeFilter } from "../transactions/schemas";

export type ListLink = {
  from: CivilDate;
  to: CivilDate;
  /** Só o que já aconteceu até este dia (o "gasto até hoje" de um mês, M13.3a) */
  upTo?: CivilDate | null;
  walletId?: string | null;
  /** Categoria (vale com as de baixo) ou "none" para sem categoria */
  categoryId?: string | "none" | null;
  accountId?: string | null;
  payer?: PayerFilter | string | null;
  type?: TransactionTypeFilter | null;
  /** A tela de onde se veio (a lista mostra "Voltar para Orçamento · Mercado") */
  back?: string | null;
  /** Busca na descrição (M10.3: os lançamentos de uma conta fixa nova) */
  text?: string | null;
};

/**
 * O endereço da lista de lançamentos com os filtros pedidos. O período é de dias, pela data de
 * caixa (ADR-025): no cartão, o mês do vencimento da fatura, como o painel soma. Sem conta, a
 * lista mostra o recorte em duas partes, contas e cartões (M13.3a).
 */
export function transactionsHref(link: ListLink): string {
  const payer =
    typeof link.payer === "string" ? (parsePayerParam(link.payer) ?? null) : (link.payer ?? null);
  return `/lancamentos?${filtersToQuery({
    walletId: link.walletId ?? null,
    filters: {
      period: { kind: "range", from: link.from, to: link.to },
      upTo: link.upTo ?? null,
      accountId: link.accountId ?? null,
      categoryId: link.categoryId ?? null,
      text: link.text ?? null,
      type: link.type ?? null,
      payers: payer ? [payer] : [],
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

/**
 * O "gasto até hoje" do mês em andamento: o mês inteiro (pela data de caixa: no cartão, as faturas
 * que vencem nele), só com o que já aconteceu até hoje. A compra de ontem no cartão conta, mesmo
 * vencendo depois de hoje (ADR-025). Num mês que não é o de hoje, o mês inteiro.
 */
export function monthToDate(
  month: MonthKey,
  today: CivilDate,
): { from: CivilDate; to: CivilDate; upTo?: CivilDate } {
  const span = monthSpan(month);
  return monthOf(today) === month ? { ...span, upTo: today } : span;
}

/** Vários meses seguidos, do dia 1 do primeiro ao último dia do último (a média de 6 meses). */
export function monthsSpan(first: MonthKey, last: MonthKey): { from: CivilDate; to: CivilDate } {
  return { from: firstDayOf(first), to: dayOfMonth(last, 31) };
}

/** O valor do filtro "Pago por" como texto da URL (para comparar). */
export const payerKey = (payer: PayerFilter | null): string | null =>
  payer ? payerParam(payer) : null;
