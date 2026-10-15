// Importar extrato (M09.3, ADR-013): as regras puras de um arquivo que a pessoa manda (OFX hoje,
// PDF no M09.4). Quem lê o arquivo é o @fintrack/importers; quem grava é o @fintrack/db. Aqui:
//
//   installmentFromDescription   a parcela ("PARC 03/06") escrita na descrição do banco
//   paymentHintFromText          PIX, boleto ou transferência pelo tipo e pela descrição
//   classifyImportRows           cada linha do arquivo: nova, já veio pelo Meu Pluggy ou já importada
//   importAccountKinds           que tipo de conta pode receber um extrato de conta ou de cartão
//   suggestImportAccount         em qual conta o arquivo entra (a pessoa confirma)
//
// Como no Meu Pluggy, tudo entra como PENDING (Recebido) e ganha a revisão do M09.2.
import type { CivilDate } from "./dates";
import type { Cents } from "./money";
import type { PaymentHint } from "./sync";
import type { AccountKind } from "./transactions";

// ── O que a descrição diz ───────────────────────────────────────────────────────

const INSTALLMENT_RE = /\bPARC(?:ELA)?\.?\s*(\d{1,2})\s*(?:\/|DE)\s*(\d{1,2})\b/i;

/**
 * A parcela escrita na descrição: "LOJA PARC 03/06", "LOJA PARC03/06", "LOJA PARCELA 3 DE 6".
 * Só com a palavra PARC na frente: "PADARIA 10/12" pode ser uma data, e uma parcela inventada
 * mudaria o par da revisão (que procura a parcela pelo número).
 */
export function installmentFromDescription(
  description: string,
): { number: number; count: number } | null {
  const match = INSTALLMENT_RE.exec(description);
  if (!match) return null;
  const number = Number.parseInt(match[1]!, 10);
  const count = Number.parseInt(match[2]!, 10);
  if (number < 1 || count < 2 || number > count) return null;
  return { number, count };
}

/**
 * A forma de pagamento que o arquivo deixa ver: o tipo do lançamento (no OFX, TRNTYPE) e a
 * descrição. Sem pista clara, null (saída vira débito e entrada vira depósito, `importedMethod`).
 */
export function paymentHintFromText(type: string | null, description: string): PaymentHint {
  const text = description.toUpperCase();
  if (/\bPIX\b/.test(text)) return "PIX";
  if (/\bBOLETO\b|\bPAGTO?\s+TITULO\b/.test(text)) return "BOLETO";
  if (type?.toUpperCase() === "XFER" || /\bTED\b|\bDOC\b|\bTRANSF/.test(text)) return "TRANSFER";
  return null;
}

// ── Já veio? ────────────────────────────────────────────────────────────────────

export type ImportRowState = "NEW" | "PLUGGY" | "IMPORTED";

/**
 * O estado de cada linha do arquivo, na ordem do arquivo:
 *   IMPORTED  o id da linha (FITID) já existe nesta conta, vindo de outro arquivo
 *   PLUGGY    a conta está ligada ao Meu Pluggy e já há um recebido dele com o mesmo valor e a
 *             mesma data. Cada recebido "cobre" uma linha só: dois cafés iguais no mesmo dia no
 *             arquivo e um no banco = um PLUGGY e um NEW
 *   NEW       entra como Recebido
 */
export function classifyImportRows(input: {
  rows: readonly { externalId: string; occurredOn: CivilDate; amount: Cents }[];
  /** Os ids de arquivo (externalId com origem OFX) que a conta já tem */
  importedIds: ReadonlySet<string>;
  /** Os lançamentos do Meu Pluggy da conta no período (apagados não entram) */
  fromPluggy: readonly { occurredOn: CivilDate; amount: Cents }[];
}): ImportRowState[] {
  const available = new Map<string, number>();
  for (const row of input.fromPluggy) {
    const key = `${row.occurredOn}|${row.amount}`;
    available.set(key, (available.get(key) ?? 0) + 1);
  }
  return input.rows.map((row) => {
    if (input.importedIds.has(row.externalId)) return "IMPORTED";
    const key = `${row.occurredOn}|${row.amount}`;
    const left = available.get(key) ?? 0;
    if (left > 0) {
      available.set(key, left - 1);
      return "PLUGGY";
    }
    return "NEW";
  });
}

// ── Em qual conta ───────────────────────────────────────────────────────────────

export type StatementKind = "BANK" | "CREDIT_CARD";

/** Extrato de conta entra em conta corrente ou poupança; extrato de cartão, em cartão. */
export function importAccountKinds(kind: StatementKind): readonly AccountKind[] {
  return kind === "CREDIT_CARD" ? ["CREDIT_CARD"] : ["CHECKING", "SAVINGS"];
}

export type ImportAccountCandidate = {
  id: string;
  kind: AccountKind;
  /** Finais dos cartões ativos da conta (só em cartão de crédito) */
  cardLastFours: readonly string[];
  /** Um arquivo do mesmo banco e do mesmo final já entrou nesta conta */
  learned: boolean;
};

export type ImportAccountSuggestion = {
  accountId: string;
  reason: "LEARNED" | "CARD_LAST_FOUR" | "ONLY_ONE";
};

/**
 * A conta sugerida para o arquivo, nesta ordem:
 *   1. a conta que já recebeu um arquivo do mesmo banco e do mesmo final;
 *   2. extrato de cartão: o cartão de crédito com um cartão ativo do mesmo final;
 *   3. a única conta do tipo certo.
 * Empate (duas contas com o mesmo motivo): sem sugestão; a pessoa escolhe.
 */
export function suggestImportAccount(input: {
  kind: StatementKind;
  lastFour: string | null;
  candidates: readonly ImportAccountCandidate[];
}): ImportAccountSuggestion | null {
  const kinds = importAccountKinds(input.kind);
  const fit = input.candidates.filter((c) => kinds.includes(c.kind));
  const single = (list: readonly ImportAccountCandidate[]) =>
    list.length === 1 ? list[0]!.id : null;

  const learned = single(fit.filter((c) => c.learned));
  if (learned) return { accountId: learned, reason: "LEARNED" };
  if (input.kind === "CREDIT_CARD" && input.lastFour) {
    const byCard = single(fit.filter((c) => c.cardLastFours.includes(input.lastFour!)));
    if (byCard) return { accountId: byCard, reason: "CARD_LAST_FOUR" };
  }
  const only = single(fit);
  return only ? { accountId: only, reason: "ONLY_ONE" } : null;
}
