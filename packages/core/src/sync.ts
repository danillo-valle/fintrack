// Coleta bancária (M09.1): as regras puras da sincronização com o banco (Meu Pluggy e, no
// M09.3 e no M09.4, os arquivos OFX e PDF). Quem fala com a API é o @fintrack/importers; quem
// grava é o @fintrack/db. Aqui só entram textos, datas e centavos, e saem decisões:
//
//   civilFromProviderTimestamp   o dia do lançamento a partir do horário que o banco manda
//   importWindow                 de que dia a que dia buscar em cada sincronização
//   importedMethod               a forma de pagamento de um lançamento que veio do banco
//   statementForDueDate          a fatura (competência) de uma Bill, a partir do vencimento
//   openStatementWindow          a fatura aberta: de que dia a que dia as compras entram nela
//   settlementCheck              a fatura confere ao centavo? (compras + encargos = total)
//   suggestAccountLink           qual conta do FinTrack corresponde a uma conta do banco
//   importChanges                o que mudou num lançamento que o banco mandou de novo
//
// Tudo que vem do banco entra como PENDING ("recebido") e fica FORA das somas até a revisão
// (ADR-011). Por isso a sincronização pode rodar quantas vezes quiser: o lançamento é achado
// pela chave (conta, origem, id no banco), e buscar de novo só atualiza o que mudou.
import { sumCents, type Cents } from "./money";
import { cleanText } from "./text";
import {
  addDays,
  addMonthsToKey,
  compareCivil,
  dayOfMonth,
  isCivilDate,
  monthOf,
  parseCivilDate,
  todayCivil,
  type CivilDate,
} from "./dates";
import { statementFor, statementOfMonth, type CardCycle, type Statement } from "./card";
import type { AccountKind, PaymentMethod } from "./transactions";

// ── Datas ───────────────────────────────────────────────────────────────────────

/**
 * O dia (data civil) de um horário que o banco manda em ISO 8601, como "2026-10-09T00:00:00.000Z".
 *
 * A Pluggy grava em UTC. Dois casos:
 *   - meia-noite UTC em ponto ("…T00:00:00.000Z"): o banco só sabe o DIA, e o dia é o da data
 *     escrita. Converter para São Paulo jogaria a compra para o dia anterior (21h do dia 8).
 *   - qualquer outro horário: é um instante de verdade; o dia é o de São Paulo
 *     ("2026-10-09T01:30:00Z" = 22h30 do dia 8 em São Paulo → "2026-10-08").
 */
export function civilFromProviderTimestamp(
  value: string,
  timeZone = "America/Sao_Paulo",
): CivilDate {
  const datePart = value.slice(0, 10);
  if (isCivilDate(datePart) && value.length === 10) return datePart; // já veio só a data
  const instant = new Date(value);
  if (Number.isNaN(instant.getTime())) throw new Error(`Data do banco inválida: "${value}"`);
  const isMidnightUtc =
    instant.getUTCHours() === 0 &&
    instant.getUTCMinutes() === 0 &&
    instant.getUTCSeconds() === 0 &&
    instant.getUTCMilliseconds() === 0;
  if (isMidnightUtc && isCivilDate(datePart)) return datePart;
  return todayCivil(instant, timeZone);
}

/** Quantos dias para trás cada sincronização relê (o banco corrige lançamentos recentes). */
export const IMPORT_OVERLAP_DAYS = 40;

/**
 * O período que a sincronização pede ao banco.
 *   - primeira vez: da data de corte (escolhida ao ligar as contas) até hoje;
 *   - depois: os últimos 40 dias (o banco ainda muda status, fatura e valor), nunca antes da
 *     data de corte. Antes da data de corte nada entra: os lançamentos manuais antigos ficam
 *     como estão e não duplicam.
 */
export function importWindow(input: {
  importFrom: CivilDate;
  lastSyncedOn: CivilDate | null;
  today: CivilDate;
  overlapDays?: number;
}): { from: CivilDate; to: CivilDate } {
  const overlap = input.overlapDays ?? IMPORT_OVERLAP_DAYS;
  if (compareCivil(input.importFrom, input.today) > 0) {
    return { from: input.importFrom, to: input.importFrom };
  }
  if (!input.lastSyncedOn) return { from: input.importFrom, to: input.today };
  const reread = addDays(input.lastSyncedOn, -overlap);
  const from = compareCivil(reread, input.importFrom) > 0 ? reread : input.importFrom;
  // Relógio do servidor atrasado em relação à última busca: nunca um período invertido
  return { from: compareCivil(from, input.today) > 0 ? input.today : from, to: input.today };
}

// ── Forma de pagamento ──────────────────────────────────────────────────────────

/** O que o banco diz sobre a forma de pagamento (paymentData.paymentMethod e operationType). */
export type PaymentHint = "PIX" | "BOLETO" | "TRANSFER" | null;

/**
 * A forma de pagamento de um lançamento importado, respeitando o que a conta aceita (a mesma
 * regra do gatilho transaction_method_matches_account):
 *   cartão de crédito  sempre CREDIT (compra, estorno ou pagamento recebido)
 *   conta corrente     PIX, BOLETO ou TRANSFER quando o banco diz; senão, saída = DEBIT e
 *                      entrada = DEPOSIT
 */
export function importedMethod(
  account: AccountKind,
  hint: PaymentHint,
  cents: Cents,
): PaymentMethod {
  if (account === "CREDIT_CARD") return "CREDIT";
  if (account === "MEAL_VOUCHER") return cents < 0n ? "VOUCHER" : "DEPOSIT";
  if (hint) return hint;
  return cents < 0n ? "DEBIT" : "DEPOSIT";
}

// ── Faturas ─────────────────────────────────────────────────────────────────────

/**
 * A fatura (competência) de uma Bill do banco, que só traz o vencimento.
 *
 * Com o ciclo da conta (dia de fechamento e de vencimento), procura a fatura cujo vencimento é
 * o da Bill: a do mês do vencimento ou a do mês anterior. Se o banco mudou o vencimento (ciclo
 * cadastrado diferente), fica com o último fechamento ANTES do vencimento. Sem ciclo, usa o
 * fechamento que o banco informou (`bankCloseDate`) ou, em último caso, o vencimento menos 10
 * dias (o prazo mais comum entre fechamento e vencimento no Brasil).
 */
export function statementForDueDate(
  dueDate: CivilDate,
  cycle: CardCycle | null,
  bankCloseDate: CivilDate | null = null,
): Statement {
  if (cycle) {
    const dueMonth = monthOf(dueDate);
    for (const month of [dueMonth, addMonthsToKey(dueMonth, -1)]) {
      const candidate = statementOfMonth(month, cycle);
      if (candidate.dueDate === dueDate) return candidate;
    }
    // Ciclo diferente do cadastrado: o último dia de fechamento antes do vencimento
    let closingDate = dayOfMonth(dueMonth, cycle.closingDay);
    if (compareCivil(closingDate, dueDate) >= 0) {
      closingDate = dayOfMonth(addMonthsToKey(dueMonth, -1), cycle.closingDay);
    }
    return { referenceMonth: monthOf(closingDate), closingDate, dueDate };
  }
  const closingDate =
    bankCloseDate && compareCivil(bankCloseDate, dueDate) < 0
      ? bankCloseDate
      : addDays(dueDate, -10);
  return { referenceMonth: monthOf(closingDate), closingDate, dueDate };
}

/**
 * A fatura aberta hoje e o período das compras que entram nela: do fechamento anterior
 * (inclusive) até o dia antes do próximo fechamento.
 *
 * O banco é a fonte mais confiável (creditData.balanceCloseDate e balanceDueDate); sem ele, o
 * ciclo cadastrado na conta. Sem nenhum dos dois, não há como dizer o período: null.
 */
export function openStatementWindow(input: {
  today: CivilDate;
  cycle: CardCycle | null;
  bankCloseDate?: CivilDate | null;
  bankDueDate?: CivilDate | null;
}): (Statement & { from: CivilDate; to: CivilDate }) | null {
  const { today, cycle } = input;
  if (input.bankCloseDate && input.bankDueDate && compareCivil(input.bankCloseDate, today) > 0) {
    const closingDate = input.bankCloseDate;
    // O fechamento anterior: o mesmo dia do mês anterior. Quando o banco informa as datas, elas
    // valem mais que o ciclo cadastrado (o banco pode ter mudado o dia do fechamento)
    const previousClose = dayOfMonth(
      addMonthsToKey(monthOf(closingDate), -1),
      parseCivilDate(closingDate).day,
    );
    return {
      referenceMonth: monthOf(closingDate),
      closingDate,
      dueDate: input.bankDueDate,
      from: previousClose,
      to: addDays(closingDate, -1),
    };
  }
  if (!cycle) return null;
  const open = statementFor(today, cycle);
  const previous = statementOfMonth(addMonthsToKey(open.referenceMonth, -1), cycle);
  return { ...open, from: previous.closingDate, to: addDays(open.closingDate, -1) };
}

/** Encargos da fatura, com os nomes do Open Finance traduzidos para o FinTrack. */
export type StatementChargeKind =
  "IOF" | "LATE_INTEREST" | "LATE_FEE" | "REMUNERATIVE_INTEREST" | "OTHER";

/**
 * A fatura confere ao centavo?
 *   total do banco = compras ligadas à fatura (saídas − estornos) + encargos (IOF, juros, multa)
 * `purchases` são os valores com sinal dos lançamentos da fatura (compra = negativo).
 * Pagamentos da fatura anterior (positivos com operação de pagamento) não entram: quem chama já
 * os separa.
 */
export function settlementCheck(input: {
  total: Cents;
  charges: readonly Cents[];
  purchases: readonly Cents[];
}): { expected: Cents; found: Cents; difference: Cents; matches: boolean } {
  const purchases = -sumCents(input.purchases); // compras negativas viram valor a pagar
  const found = purchases + sumCents(input.charges);
  const difference = input.total - found;
  return { expected: input.total, found, difference, matches: difference === 0n };
}

// ── Ligar as contas ─────────────────────────────────────────────────────────────

/** Os 4 últimos dígitos de um número mascarado ("****1234", "1234", "5502 **** 0001"). */
export function lastFourOf(number: string | null | undefined): string | null {
  if (!number) return null;
  const digits = number.replace(/\D/g, "");
  return digits.length >= 4 ? digits.slice(-4) : null;
}

export type ProviderAccountLike = {
  kind: "CHECKING" | "SAVINGS" | "CREDIT_CARD";
  name: string;
  number: string | null;
};

export type LinkCandidate = {
  id: string;
  kind: AccountKind;
  name: string;
  institution: string | null;
  /** Finais dos cartões ativos da conta (só cartão de crédito tem) */
  lastFours: readonly string[];
  /** Conta já ligada a outra conta do banco não entra como sugestão */
  linked: boolean;
};

export type LinkSuggestion = { accountId: string; reason: "LAST_FOUR" | "NAME" };

const comparable = (text: string) =>
  text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/**
 * A conta do FinTrack que provavelmente é esta conta do banco, para a tela já vir preenchida
 * (a pessoa confirma ou troca):
 *   1. cartão de crédito com um cartão de mesmo final (o banco só devolve o final);
 *   2. mesmo tipo e nome parecido (um contém o outro, sem acento e sem pontuação).
 * Duas candidatas empatadas = nenhuma sugestão (melhor a pessoa escolher do que errar).
 */
export function suggestAccountLink(
  account: ProviderAccountLike,
  candidates: readonly LinkCandidate[],
): LinkSuggestion | null {
  const free = candidates.filter((c) => !c.linked && c.kind === account.kind);
  if (account.kind === "CREDIT_CARD") {
    const lastFour = lastFourOf(account.number);
    if (lastFour) {
      const byFinal = free.filter((c) => c.lastFours.includes(lastFour));
      if (byFinal.length === 1)
        return { accountId: (byFinal[0] as LinkCandidate).id, reason: "LAST_FOUR" };
      if (byFinal.length > 1) return null;
    }
  }
  const name = comparable(account.name);
  if (name.length < 3) return null;
  const byName = free.filter((c) => {
    const other = comparable(`${c.institution ?? ""} ${c.name}`);
    const own = comparable(c.name);
    return other.includes(name) || name.includes(own) || own.includes(name);
  });
  return byName.length === 1
    ? { accountId: (byName[0] as LinkCandidate).id, reason: "NAME" }
    : null;
}

// ── Lançamentos que o banco manda de novo ───────────────────────────────────────

/** Os campos que o banco pode corrigir depois (a categoria e a revisão são da pessoa). */
export type ImportedFields = {
  occurredOn: CivilDate;
  description: string;
  amount: Cents;
  statementExternalId: string | null;
  cardLastFour: string | null;
  installment: { number: number; count: number } | null;
  original: { amount: Cents; currency: string } | null;
  providerCategory: string | null;
};

/**
 * O que mudou entre o lançamento gravado e o que o banco mandou agora. Lista vazia = nada a
 * gravar ("sem mudança"). A categoria escolhida pela pessoa e o status (PENDING/CONFIRMED)
 * nunca entram aqui: o banco não decide isso.
 */
export function importChanges(
  current: ImportedFields,
  incoming: ImportedFields,
): (keyof ImportedFields)[] {
  const changed: (keyof ImportedFields)[] = [];
  if (current.occurredOn !== incoming.occurredOn) changed.push("occurredOn");
  if (current.description !== incoming.description) changed.push("description");
  if (current.amount !== incoming.amount) changed.push("amount");
  if (current.statementExternalId !== incoming.statementExternalId)
    changed.push("statementExternalId");
  if (current.cardLastFour !== incoming.cardLastFour) changed.push("cardLastFour");
  const ci = current.installment;
  const ii = incoming.installment;
  if (
    (ci?.number ?? null) !== (ii?.number ?? null) ||
    (ci?.count ?? null) !== (ii?.count ?? null)
  ) {
    changed.push("installment");
  }
  const co = current.original;
  const io = incoming.original;
  if (
    (co?.amount ?? null) !== (io?.amount ?? null) ||
    (co?.currency ?? null) !== (io?.currency ?? null)
  ) {
    changed.push("original");
  }
  if (current.providerCategory !== incoming.providerCategory) changed.push("providerCategory");
  return changed;
}

/** Descrição do banco limpa (cleanText, M12.4a) e no tamanho da coluna (1 a 200, CHECK do M07). */
export function importedDescription(raw: string): string {
  const text = cleanText(raw).replace(/\s+/g, " ").trim();
  if (text.length === 0) return "Lançamento do banco";
  return text.length > 200 ? `${text.slice(0, 199)}…` : text;
}

// ── Para qual ambiente vai cada compra importada ────────────────────────────────

/**
 * O ambiente ("de quem é") de uma compra que veio do banco, pelo cartão usado (M09.1):
 *   1. o ambiente escolhido para o cartão ("Compras importadas entram em…");
 *   2. adicional de OUTRA pessoa (o portador não é o titular da conta): o ambiente pessoal do
 *      portador. É o caso do adicional do cônjuge: a fatura é do titular, a compra é de quem usou;
 *   3. senão, o ambiente da conta.
 * Sem cartão reconhecido (o banco não mandou o final), também o ambiente da conta.
 */
export function importWalletFor(input: {
  account: { walletId: string; holderId: string | null };
  card: { holderId: string | null; importWalletId: string | null } | null;
  /** Ambiente pessoal de cada pessoa do lar (userId → walletId) */
  personalWallets: ReadonlyMap<string, string>;
}): { walletId: string; viewerId: string | null } {
  const { account, card } = input;
  if (card?.importWalletId) return { walletId: card.importWalletId, viewerId: null };
  if (card?.holderId && card.holderId !== account.holderId) {
    const personal = input.personalWallets.get(card.holderId);
    if (personal) return { walletId: personal, viewerId: card.holderId };
  }
  return { walletId: account.walletId, viewerId: null };
}
