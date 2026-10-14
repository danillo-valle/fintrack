// Revisão e reconciliação (M09.2, ADR-012): as regras puras que decidem se um lançamento que
// veio do banco ("recebido") é o MESMO que a pessoa já tinha lançado, e o que fica de cada lado
// quando ela confirma. Quem lê e grava é o @fintrack/db; aqui só entram ids, datas, centavos e
// textos, e saem sugestões e decisões:
//
//   suggestPairs        recebido × seu lançamento: SAME (o mesmo gasto) ou INSTALLMENT (a parcela)
//   suggestRefunds      crédito do banco × compra anterior da mesma loja e do mesmo valor (estorno)
//   pairedFields        o lançamento que fica depois de juntar o par
//   bulkConfirmable     quais recebidos entram no "Confirmar os N que já têm categoria"
//   cardForLastFour     o cartão de um final que o banco mandou (titular ou adicional)
//   unregisteredFinals  os finais que o banco mandou e que não estão cadastrados
//
// As regras (aprovadas com a pessoa no canvas, linha E.2):
//   - par = mesma conta, MESMO valor ao centavo e datas a até 5 dias. A descrição nunca decide
//     sozinha: ela só ordena as sugestões ("UBER *TRIP" fica com "Uber para o trabalho");
//   - parcela = o "3 de 6" do banco com a sua parcela 3 de 6 do mesmo valor, sem olhar a data
//     (o banco põe a parcela no dia da fatura; o FinTrack, no dia da compra);
//   - estorno = crédito do banco do mesmo valor e da mesma loja que uma compra de até 90 dias antes;
//   - um lançamento entra em no máximo um par (escolha gulosa, do par mais provável ao menos);
//   - fica o SEU lançamento (descrição, categoria, ambiente, observação) com o valor, a data e o
//     id do banco: assim a próxima busca acha o lançamento e não duplica.
import { matchText, merchantKey } from "./categorization";
import { daysBetween, type CivilDate } from "./dates";
import type { Cents } from "./money";

/** Datas a até 5 dias: o banco lança a compra no dia em que ela foi processada, não no da compra. */
export const PAIR_WINDOW_DAYS = 5;
/** Estorno de até 90 dias depois da compra (prazo comum de devolução e de contestação). */
export const REFUND_WINDOW_DAYS = 90;

export type MatchKind = "SAME" | "INSTALLMENT" | "REFUND";

export type InstallmentInfo = { number: number; count: number };

/** Um lançamento que veio do banco e espera revisão (status PENDING). */
export type ReceivedForMatch = {
  id: string;
  accountId: string;
  cardId: string | null;
  amount: Cents;
  occurredOn: CivilDate;
  description: string;
  /** A parcela como o banco informa ("3 de 6") */
  installment: InstallmentInfo | null;
};

/**
 * Um lançamento da pessoa (manual, de recorrência...) que ainda não tem o id do banco: candidato
 * a par. Quem chama já tirou os apagados, os que vieram do banco e os pares recusados.
 */
export type OwnForMatch = {
  id: string;
  accountId: string;
  cardId: string | null;
  amount: Cents;
  occurredOn: CivilDate;
  description: string;
  /** A parcela da compra parcelada do FinTrack (número e total do grupo) */
  installment: InstallmentInfo | null;
};

/** Uma compra (saída) já conferida que pode ter sido estornada. */
export type RefundTarget = {
  id: string;
  accountId: string;
  amount: Cents;
  occurredOn: CivilDate;
  description: string;
};

export type MatchSuggestion = {
  receivedId: string;
  ownId: string;
  kind: MatchKind;
  /** Dias entre as duas datas (sempre >= 0) */
  daysApart: number;
  /** Quanto as descrições se parecem, de 0 a 1 (só ordena; nunca decide) */
  similarity: number;
};

// Palavras de estorno que o banco põe antes do nome da loja
const REFUND_WORDS = new Set([
  "estorno",
  "est",
  "devolucao",
  "reembolso",
  "credito",
  "cancelamento",
]);

function tokens(description: string, drop?: ReadonlySet<string>): Set<string> {
  const base = drop
    ? matchText(description)
        .split(" ")
        .filter((t) => !drop.has(t))
        .join(" ")
    : description;
  return new Set(merchantKey(base).split(" ").filter(Boolean));
}

/**
 * Quanto duas descrições se parecem (0 a 1): a parte em comum das "chaves do comerciante"
 * (Jaccard). "UBER *TRIP 1234" × "Uber para o trabalho" = 0,33; "Netflix" × "Padaria" = 0.
 */
export function descriptionSimilarity(a: string, b: string, drop?: ReadonlySet<string>): number {
  const ta = tokens(a, drop);
  const tb = tokens(b, drop);
  if (ta.size === 0 || tb.size === 0) return 0;
  let common = 0;
  for (const t of ta) if (tb.has(t)) common += 1;
  // Um token parecido no começo ("uber" × "ubertrip") também conta: o banco cola palavras
  if (common === 0) {
    const [fa] = ta;
    const [fb] = tb;
    if (fa && fb && fa.length >= 4 && fb.length >= 4 && (fa.startsWith(fb) || fb.startsWith(fa)))
      common = 1;
  }
  return common / (ta.size + tb.size - common);
}

/** A chave de um par recusado ("Não é o mesmo"): a sugestão não volta. */
export const pairKey = (receivedId: string, ownId: string) => `${receivedId}:${ownId}`;

const sameInstallment = (a: InstallmentInfo | null, b: InstallmentInfo | null) =>
  a !== null && b !== null && a.number === b.number && a.count === b.count;

/** O par possível entre um recebido e um lançamento seu, ou null se as regras não deixam. */
export function pairCandidate(
  received: ReceivedForMatch,
  own: OwnForMatch,
): MatchSuggestion | null {
  if (received.accountId !== own.accountId || received.amount !== own.amount) return null;
  const daysApart = Math.abs(daysBetween(own.occurredOn, received.occurredOn));
  const similarity = descriptionSimilarity(received.description, own.description);
  if (sameInstallment(received.installment, own.installment)) {
    return { receivedId: received.id, ownId: own.id, kind: "INSTALLMENT", daysApart, similarity };
  }
  // Duas parcelas diferentes ("3 de 6" × "4 de 6") nunca são o mesmo lançamento
  if (received.installment && own.installment) return null;
  if (daysApart > PAIR_WINDOW_DAYS) return null;
  return { receivedId: received.id, ownId: own.id, kind: "SAME", daysApart, similarity };
}

type Ranked = MatchSuggestion & { cardMatch: boolean };

/**
 * A ordem das sugestões: a parcela certa primeiro, depois a descrição mais parecida, a data mais
 * próxima, o mesmo cartão e, no empate, os ids (para a tela não trocar de sugestão a cada visita).
 */
function compareRanked(a: Ranked, b: Ranked): number {
  const kindRank = (k: MatchKind) => (k === "INSTALLMENT" ? 0 : 1);
  return (
    kindRank(a.kind) - kindRank(b.kind) ||
    b.similarity - a.similarity ||
    a.daysApart - b.daysApart ||
    (a.cardMatch === b.cardMatch ? 0 : a.cardMatch ? -1 : 1) ||
    a.receivedId.localeCompare(b.receivedId) ||
    a.ownId.localeCompare(b.ownId)
  );
}

function greedy(edges: Ranked[]): MatchSuggestion[] {
  const usedReceived = new Set<string>();
  const usedOwn = new Set<string>();
  const chosen: MatchSuggestion[] = [];
  for (const edge of edges.toSorted(compareRanked)) {
    if (usedReceived.has(edge.receivedId) || usedOwn.has(edge.ownId)) continue;
    usedReceived.add(edge.receivedId);
    usedOwn.add(edge.ownId);
    chosen.push({
      receivedId: edge.receivedId,
      ownId: edge.ownId,
      kind: edge.kind,
      daysApart: edge.daysApart,
      similarity: edge.similarity,
    });
  }
  return chosen;
}

/**
 * Os pares sugeridos entre os recebidos e os seus lançamentos: cada lado entra em no máximo um
 * par. Dois cafés de R$ 8,00 no mesmo dia viram dois pares, um para cada.
 */
export function suggestPairs(
  received: readonly ReceivedForMatch[],
  own: readonly OwnForMatch[],
  rejected: ReadonlySet<string> = new Set(),
): MatchSuggestion[] {
  const edges: Ranked[] = [];
  for (const r of received) {
    for (const o of own) {
      if (rejected.has(pairKey(r.id, o.id))) continue;
      const candidate = pairCandidate(r, o);
      if (candidate) {
        edges.push({
          ...candidate,
          cardMatch: r.cardId !== null && r.cardId === o.cardId,
        });
      }
    }
  }
  return greedy(edges);
}

/**
 * Os estornos sugeridos: um crédito do banco (valor positivo) e uma compra da mesma conta, do
 * mesmo valor, feita até 90 dias antes, na mesma loja (descrições com a mesma loja depois de
 * tirar "ESTORNO", "DEVOLUCAO"...). Cada compra é estornada uma vez; a compra mais recente ganha.
 */
export function suggestRefunds(
  received: readonly ReceivedForMatch[],
  purchases: readonly RefundTarget[],
  rejected: ReadonlySet<string> = new Set(),
): MatchSuggestion[] {
  const edges: Ranked[] = [];
  for (const r of received) {
    if (r.amount <= 0n) continue;
    for (const p of purchases) {
      if (rejected.has(pairKey(r.id, p.id))) continue;
      if (p.accountId !== r.accountId || p.amount !== -r.amount) continue;
      const days = daysBetween(p.occurredOn, r.occurredOn);
      if (days < 0 || days > REFUND_WINDOW_DAYS) continue;
      const similarity = descriptionSimilarity(r.description, p.description, REFUND_WORDS);
      if (similarity < 0.5) continue; // a loja precisa ser a mesma
      edges.push({
        receivedId: r.id,
        ownId: p.id,
        kind: "REFUND",
        daysApart: days,
        similarity,
        cardMatch: false,
      });
    }
  }
  return greedy(edges);
}

// ── Juntar o par ────────────────────────────────────────────────────────────────

/** Os campos do lançamento que a pessoa decide (os do recebido vêm do banco). */
export type OwnSide = {
  walletId: string;
  cardId: string | null;
  description: string;
  categoryId: string | null;
  categorizedBy: string | null;
  notes: string | null;
  installmentGroupId: string | null;
  installmentNumber: number | null;
  recurrenceId: string | null;
  transferId: string | null;
};

export type BankSide = {
  cardId: string | null;
  categoryId: string | null;
  categorizedBy: string | null;
};

/**
 * O lançamento que fica depois de juntar o par. Ele é o RECEBIDO (que tem o id do banco, para a
 * próxima busca achar e não duplicar), com tudo que a pessoa decidiu do SEU lado:
 *   do banco        valor, data, fatura, id no banco (não mudam: quem chama não os toca)
 *   seu             descrição, categoria, ambiente, observação, parcela, recorrência, transferência
 *   cartão          o do banco quando ele mandou o final; senão, o que você escolheu
 *   categoria       a sua; sem a sua, a sugestão que o recebido já tinha
 * Transferência (pagamento de fatura, PIX entre contas) nunca tem categoria (CHECK do M07).
 */
export function pairedFields(bank: BankSide, own: OwnSide) {
  const ownCategory = own.categoryId !== null;
  const categoryId = own.transferId ? null : ownCategory ? own.categoryId : bank.categoryId;
  const categorizedBy =
    categoryId === null ? null : ownCategory ? own.categorizedBy : bank.categorizedBy;
  return {
    walletId: own.walletId,
    cardId: bank.cardId ?? own.cardId,
    description: own.description,
    categoryId,
    categorizedBy,
    notes: own.notes,
    installmentGroupId: own.installmentGroupId,
    installmentNumber: own.installmentNumber,
    recurrenceId: own.recurrenceId,
    transferId: own.transferId,
  };
}

// ── Confirmar em lote ───────────────────────────────────────────────────────────

/**
 * Os recebidos que o "Confirmar os N que já têm categoria" confirma: os que têm categoria e
 * NÃO têm par sugerido (confirmar um recebido com par criaria o gasto em dobro; esse a pessoa
 * decide um a um). Transferência confirma sem categoria.
 */
export function bulkConfirmable<
  T extends { id: string; categoryId: string | null; transferId?: string | null },
>(rows: readonly T[], withSuggestion: ReadonlySet<string>): T[] {
  return rows.filter(
    (r) => (r.categoryId !== null || Boolean(r.transferId)) && !withSuggestion.has(r.id),
  );
}

// ── Cartões adicionais ──────────────────────────────────────────────────────────

/**
 * O cartão de um lançamento pelo final que o banco mandou:
 *   - com final: só o cartão de MESMO final. Final que não está cadastrado (um adicional novo)
 *     fica sem cartão, e não no titular: a compra não é dele, e a tela mostra o final para a
 *     pessoa cadastrar;
 *   - sem final: o cartão único da conta, se ela tiver um só.
 */
export function cardForLastFour<C extends { lastFour: string }>(
  cards: readonly C[],
  lastFour: string | null,
): C | null {
  if (lastFour) return cards.find((c) => c.lastFour === lastFour) ?? null;
  return cards.length === 1 ? (cards[0] ?? null) : null;
}

export type UnregisteredFinal = {
  lastFour: string;
  count: number;
  /** Soma com sinal dos lançamentos com esse final */
  total: Cents;
  lastSeen: CivilDate;
};

/** Os finais que o banco mandou e que não estão cadastrados na conta (do mais recente ao mais antigo). */
export function unregisteredFinals(
  rows: readonly { lastFour: string | null; amount: Cents; occurredOn: CivilDate }[],
  registered: readonly string[],
): UnregisteredFinal[] {
  const known = new Set(registered);
  const byFinal = new Map<string, UnregisteredFinal>();
  for (const row of rows) {
    if (!row.lastFour || known.has(row.lastFour)) continue;
    const current = byFinal.get(row.lastFour);
    if (!current) {
      byFinal.set(row.lastFour, {
        lastFour: row.lastFour,
        count: 1,
        total: row.amount,
        lastSeen: row.occurredOn,
      });
      continue;
    }
    current.count += 1;
    current.total += row.amount;
    if (row.occurredOn > current.lastSeen) current.lastSeen = row.occurredOn;
  }
  return [...byFinal.values()].sort(
    (a, b) => b.lastSeen.localeCompare(a.lastSeen) || a.lastFour.localeCompare(b.lastFour),
  );
}
