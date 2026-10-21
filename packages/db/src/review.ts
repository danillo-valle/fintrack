// Revisão e reconciliação (M09.2, ADR-012): o que veio do banco entra PENDING ("recebido") e
// fica fora das somas até a pessoa conferir. Aqui ficam a fila da revisão e as decisões:
//
//   reviewQueue       os recebidos, os pares sugeridos (o mesmo gasto, a parcela, o estorno) e
//                     os finais de cartão que o banco mandou e não estão cadastrados
//   confirmReceived   um recebido → confirmado (com o ambiente escolhido na linha)
//   confirmBulk       "Confirmar os N que já têm categoria" (da fatura, da conta ou de tudo)
//   undoReview        desfaz uma confirmação simples ou em lote (o aviso "Desfazer")
//   confirmPair       junta o recebido e o seu lançamento: fica UM, o recebido, com o seu lado
//   rejectPair        "Não é o mesmo": a sugestão não volta
//   linkRefund        "Ligar ao original": o crédito do banco vira estorno da compra
//   undoMatch         desfaz um par ou um estorno, devolvendo os dois lados como estavam
//   rerouteReceived   depois de cadastrar (ou arquivar) um cartão, os recebidos do final vão para
//                     o cartão e o ambiente certos
//
// As regras de par vivem no @fintrack/core (reconcile.ts) e são conferidas DE NOVO aqui antes de
// gravar: a tela sugere, o servidor decide. Toda decisão roda numa transação, com UPDATE
// condicional (status ainda PENDING, lançamento ainda não apagado): duas abas confirmando o
// mesmo recebido dão um sucesso e um REVIEW_STALE, nunca um par em dobro.
import {
  addDays,
  bulkConfirmable,
  cardForLastFour,
  civilFromDbDate,
  dbDateFromCivil,
  importWalletFor,
  LOCAL_AI_BULK_SOURCES,
  pairCandidate,
  pairedFields,
  pairKey,
  PAIR_WINDOW_DAYS,
  REFUND_WINDOW_DAYS,
  suggestPairs,
  suggestRefunds,
  unregisteredFinals,
  type CivilDate,
  type MatchKind,
  type MatchSuggestion,
  type OwnForMatch,
  type ReceivedForMatch,
  type RefundTarget,
} from "@fintrack/core";
import { DomainError, type WalletScope } from "./access";
import { writeAudit, type RequestContext } from "./audit";
import type { Prisma, PrismaClient } from "./generated/prisma/client";
import { localAiEnabled } from "./local-ai";
import type { CategorizationSource } from "./generated/prisma/enums";
import { fromDbDecimal, toDbDecimal } from "./money";
import { personalWalletsOf, rerouteWallet } from "./sync";

/** Quantos recebidos a fila carrega de uma vez (o resto aparece ao confirmar os primeiros). */
export const REVIEW_QUEUE_LIMIT = 500;
/** Até quando o "Desfazer" de uma confirmação simples ou em lote vale. */
export const REVIEW_UNDO_MS = 30 * 60 * 1000;

type Db = PrismaClient | Prisma.TransactionClient;

// ── Leitura ─────────────────────────────────────────────────────────────────────

const RECEIVED_SELECT = {
  id: true,
  accountId: true,
  cardId: true,
  walletId: true,
  statementId: true,
  amount: true,
  occurredOn: true,
  description: true,
  categoryId: true,
  categorizedBy: true,
  categorizationConfidence: true,
  transferId: true,
  notes: true,
  status: true,
  deletedAt: true,
  reversalOfId: true,
  installmentGroupId: true,
  installmentNumber: true,
  recurrenceId: true,
  providerInstallmentNumber: true,
  providerInstallmentCount: true,
  providerCardLastFour: true,
  source: true,
  // M10.2b: o que a IA local respondeu (a proposta de categoria nova fica aqui)
  localAiAttempt: {
    select: {
      outcome: true,
      proposedName: true,
      proposedParent: { select: { id: true, name: true } },
    },
  },
  wallet: { select: { name: true } },
  category: { select: { id: true, name: true, parent: { select: { name: true } } } },
  card: { select: { lastFour: true, isAdditional: true, holder: { select: { name: true } } } },
  account: { select: { name: true, kind: true } },
  statement: { select: { referenceMonth: true } },
} satisfies Prisma.TransactionSelect;

type ReceivedRow = Prisma.TransactionGetPayload<{ select: typeof RECEIVED_SELECT }>;

const OWN_SELECT = {
  id: true,
  accountId: true,
  cardId: true,
  walletId: true,
  amount: true,
  occurredOn: true,
  description: true,
  status: true,
  source: true,
  deletedAt: true,
  categoryId: true,
  categorizedBy: true,
  categorizationConfidence: true,
  notes: true,
  installmentGroupId: true,
  installmentNumber: true,
  recurrenceId: true,
  transferId: true,
  installmentGroup: { select: { installmentCount: true } },
  wallet: { select: { name: true } },
  category: { select: { id: true, name: true, parent: { select: { name: true } } } },
  card: { select: { lastFour: true } },
} satisfies Prisma.TransactionSelect;

type OwnRow = Prisma.TransactionGetPayload<{ select: typeof OWN_SELECT }>;

function receivedForMatch(row: ReceivedRow): ReceivedForMatch {
  return {
    id: row.id,
    accountId: row.accountId,
    cardId: row.cardId,
    amount: fromDbDecimal(row.amount),
    occurredOn: civilFromDbDate(row.occurredOn),
    description: row.description,
    installment:
      row.providerInstallmentNumber !== null && row.providerInstallmentCount !== null
        ? { number: row.providerInstallmentNumber, count: row.providerInstallmentCount }
        : null,
  };
}

function ownForMatch(row: OwnRow): OwnForMatch {
  return {
    id: row.id,
    accountId: row.accountId,
    cardId: row.cardId,
    amount: fromDbDecimal(row.amount),
    occurredOn: civilFromDbDate(row.occurredOn),
    description: row.description,
    installment:
      row.installmentNumber !== null && row.installmentGroup
        ? { number: row.installmentNumber, count: row.installmentGroup.installmentCount }
        : null,
  };
}

const categoryView = (c: ReceivedRow["category"]) =>
  c ? { id: c.id, name: c.name, parent: c.parent?.name ?? null } : null;

export type ReceivedView = ReturnType<typeof receivedView>;

/**
 * A IA local num recebido (M10.2b): na fila (lar com a IA ligada, veio de uma carga, sem
 * categoria e ainda não visto) e a categoria nova proposta, enquanto o recebido segue sem
 * categoria.
 */
function localAiView(row: ReceivedRow, aiOn: boolean) {
  const attempt = row.localAiAttempt;
  const fromBulk = (LOCAL_AI_BULK_SOURCES as readonly string[]).includes(row.source);
  return {
    queued: aiOn && fromBulk && !attempt && row.categoryId === null && row.transferId === null,
    proposal:
      attempt?.outcome === "NEW_CATEGORY" && attempt.proposedName && row.categoryId === null
        ? { name: attempt.proposedName, parent: attempt.proposedParent }
        : null,
  };
}

function receivedView(row: ReceivedRow, editable: ReadonlySet<string>, aiOn = false) {
  const match = receivedForMatch(row);
  return {
    id: row.id,
    occurredOn: match.occurredOn,
    description: row.description,
    amount: match.amount,
    installment: match.installment,
    category: categoryView(row.category),
    categorizedBy: row.categorizedBy,
    categorizationConfidence: row.categorizationConfidence,
    isTransfer: row.transferId !== null,
    wallet: { id: row.walletId, name: row.wallet.name },
    account: { id: row.accountId, name: row.account.name, kind: row.account.kind },
    /** O cartão reconhecido; sem ele, o final que o banco mandou (não cadastrado) */
    card: row.card
      ? {
          lastFour: row.card.lastFour,
          holder: row.card.holder?.name ?? null,
          additional: row.card.isAdditional,
        }
      : null,
    unknownLastFour: row.card ? null : row.providerCardLastFour,
    statementMonth: row.statement
      ? civilFromDbDate(row.statement.referenceMonth).slice(0, 7)
      : null,
    canEdit: editable.has(row.walletId),
    localAi: localAiView(row, aiOn),
  };
}

export type OwnView = ReturnType<typeof ownView>;

function ownView(row: OwnRow) {
  const match = ownForMatch(row);
  return {
    id: row.id,
    occurredOn: match.occurredOn,
    description: row.description,
    amount: match.amount,
    status: row.status,
    installment: match.installment,
    category: categoryView(row.category),
    categorizedBy: row.categorizedBy,
    wallet: { id: row.walletId, name: row.wallet.name },
    cardLastFour: row.card?.lastFour ?? null,
  };
}

/** Os lançamentos SEUS que podem ser par de algum recebido (só nas carteiras que você edita). */
async function ownCandidates(
  db: Db,
  walletIds: readonly string[],
  received: readonly ReceivedForMatch[],
): Promise<OwnRow[]> {
  if (received.length === 0 || walletIds.length === 0) return [];
  const dates = received.map((r) => r.occurredOn).sort();
  const from = addDays(dates[0] as CivilDate, -PAIR_WINDOW_DAYS);
  const to = addDays(dates.at(-1) as CivilDate, PAIR_WINDOW_DAYS);
  const amounts = [...new Set(received.map((r) => r.amount))];
  return db.transaction.findMany({
    where: {
      accountId: { in: [...new Set(received.map((r) => r.accountId))] },
      walletId: { in: [...walletIds] },
      deletedAt: null,
      status: { in: ["SCHEDULED", "CONFIRMED"] },
      source: { not: "OPEN_FINANCE" },
      amount: { in: amounts.map(toDbDecimal) },
      // A parcela é par sem olhar a data; o resto, só na janela de 5 dias
      OR: [
        { occurredOn: { gte: dbDateFromCivil(from), lte: dbDateFromCivil(to) } },
        { installmentGroupId: { not: null } },
      ],
    },
    select: OWN_SELECT,
  });
}

/** As compras conferidas que um crédito do banco pode estar estornando. */
async function refundCandidates(
  db: Db,
  walletIds: readonly string[],
  received: readonly ReceivedForMatch[],
): Promise<OwnRow[]> {
  const credits = received.filter((r) => r.amount > 0n);
  if (credits.length === 0 || walletIds.length === 0) return [];
  const dates = credits.map((r) => r.occurredOn).sort();
  return db.transaction.findMany({
    where: {
      accountId: { in: [...new Set(credits.map((r) => r.accountId))] },
      walletId: { in: [...walletIds] },
      deletedAt: null,
      status: "CONFIRMED",
      transferId: null,
      amount: { in: [...new Set(credits.map((r) => -r.amount))].map(toDbDecimal) },
      occurredOn: {
        gte: dbDateFromCivil(addDays(dates[0] as CivilDate, -REFUND_WINDOW_DAYS)),
        lte: dbDateFromCivil(dates.at(-1) as CivilDate),
      },
      // Compra já estornada não recebe outro estorno do mesmo valor
      reversals: { none: { deletedAt: null } },
    },
    select: OWN_SELECT,
  });
}

const refundTarget = (row: OwnRow): RefundTarget => {
  const m = ownForMatch(row);
  return {
    id: m.id,
    accountId: m.accountId,
    amount: m.amount,
    occurredOn: m.occurredOn,
    description: m.description,
  };
};

/** As sugestões (par e estorno) para os recebidos, com os lados já carregados. */
async function suggestionsFor(
  db: Db,
  editWalletIds: readonly string[],
  received: readonly ReceivedRow[],
) {
  const forMatch = received.filter((r) => editWalletIds.includes(r.walletId)).map(receivedForMatch);
  // Uma consulta de cada vez: dentro de uma transação, o cliente não aceita consultas paralelas
  const own = await ownCandidates(db, editWalletIds, forMatch);
  const refunds = await refundCandidates(db, editWalletIds, forMatch);
  const rejectedRows =
    forMatch.length === 0
      ? []
      : await db.transactionMatch.findMany({
          where: { status: "REJECTED", receivedId: { in: forMatch.map((r) => r.id) } },
          select: { receivedId: true, ownId: true },
        });
  const rejected = new Set(rejectedRows.map((m) => pairKey(m.receivedId, m.ownId)));
  const pairs = suggestPairs(forMatch, own.map(ownForMatch), rejected);
  const paired = new Set(pairs.map((p) => p.receivedId));
  const usedOwn = new Set(pairs.map((p) => p.ownId));
  // Estorno só para quem ficou sem par, e nunca com uma compra que já virou par
  const refundSuggestions = suggestRefunds(
    forMatch.filter((r) => !paired.has(r.id)),
    refunds.filter((r) => !usedOwn.has(r.id)).map(refundTarget),
    rejected,
  );
  const rows = new Map([...own, ...refunds].map((r) => [r.id, r]));
  return { suggestions: [...pairs, ...refundSuggestions], rows };
}

export type PairView = {
  kind: MatchKind;
  daysApart: number;
  received: ReceivedView;
  own: OwnView;
};

export type ReviewGroup = {
  /** "statement:<id>" ou "account:<id>" (a chave do "Confirmar os N" do grupo) */
  key: string;
  accountId: string;
  statementId: string | null;
  accountName: string;
  /** Mês da fatura (AAAA-MM) quando o grupo é uma fatura */
  statementMonth: string | null;
  items: ReceivedView[];
  confirmable: number;
  withCategory: number;
};

/**
 * A fila da revisão nas carteiras que a pessoa vê. Pares e estornos só aparecem quando ela pode
 * editar os dois lados; o resto aparece para todos, com "Confirmar" só para quem edita.
 */
export async function reviewQueue(
  db: PrismaClient,
  scope: WalletScope<"view">,
  editScope: WalletScope<"edit">,
) {
  const walletIds = [...scope.walletIds];
  const editable = new Set(editScope.walletIds);
  const where = {
    walletId: { in: walletIds },
    status: "PENDING",
    deletedAt: null,
  } satisfies Prisma.TransactionWhereInput;
  const [total, rows, aiOn] = await Promise.all([
    walletIds.length === 0 ? 0 : db.transaction.count({ where }),
    walletIds.length === 0
      ? []
      : db.transaction.findMany({
          where,
          orderBy: [{ occurredOn: "desc" }, { id: "asc" }],
          take: REVIEW_QUEUE_LIMIT,
          select: RECEIVED_SELECT,
        }),
    localAiEnabled(db, scope.householdId),
  ]);
  const { suggestions, rows: ownRows } = await suggestionsFor(db, editScope.walletIds, rows);
  const byId = new Map(rows.map((r) => [r.id, r]));
  const pairs: PairView[] = suggestions.flatMap((s) => {
    const r = byId.get(s.receivedId);
    const o = ownRows.get(s.ownId);
    return r && o
      ? [
          {
            kind: s.kind,
            daysApart: s.daysApart,
            received: receivedView(r, editable, aiOn),
            own: ownView(o),
          },
        ]
      : [];
  });
  const withSuggestion = new Set(suggestions.map((s) => s.receivedId));

  // Os recebidos sem par, agrupados pela fatura (cartão) ou pela conta (corrente)
  const groups = new Map<string, ReviewGroup>();
  for (const row of rows) {
    if (withSuggestion.has(row.id)) continue;
    const key = row.statementId ? `statement:${row.statementId}` : `account:${row.accountId}`;
    let group = groups.get(key);
    if (!group) {
      group = {
        key,
        accountId: row.accountId,
        statementId: row.statementId,
        accountName: row.account.name,
        statementMonth: row.statement
          ? civilFromDbDate(row.statement.referenceMonth).slice(0, 7)
          : null,
        items: [],
        confirmable: 0,
        withCategory: 0,
      };
      groups.set(key, group);
    }
    const view = receivedView(row, editable, aiOn);
    group.items.push(view);
    if (view.category || view.isTransfer) group.withCategory += 1;
  }
  for (const group of groups.values()) {
    // A categoria da IA local não entra no lote (bulkConfirmable): confirmada uma a uma
    group.confirmable = group.items.filter(
      (i) => i.canEdit && (i.category !== null || i.isTransfer) && i.categorizedBy !== "LLM",
    ).length;
  }

  // Os finais que o banco mandou e não estão cadastrados, por conta
  const finals = [...new Set(rows.map((r) => r.accountId))].flatMap((accountId) => {
    const ofAccount = rows.filter((r) => r.accountId === accountId && r.cardId === null);
    const name = rows.find((r) => r.accountId === accountId)?.account.name ?? "";
    return unregisteredFinals(
      ofAccount.map((r) => ({
        lastFour: r.providerCardLastFour,
        amount: fromDbDecimal(r.amount),
        occurredOn: civilFromDbDate(r.occurredOn),
      })),
      [],
    ).map((f) => ({ ...f, accountId, accountName: name }));
  });

  const confirmable = [...groups.values()].reduce((sum, g) => sum + g.confirmable, 0);
  return {
    total,
    truncated: total > rows.length,
    pairs,
    groups: [...groups.values()],
    confirmable,
    uncategorized: rows.filter((r) => r.categoryId === null && r.transferId === null).length,
    /** M10.2b: a IA local está ligada no lar, e quantos destes estão na fila dela */
    localAiOn: aiOn,
    localAiQueued: rows.filter((r) => localAiView(r, aiOn).queued).length,
    finals,
  };
}

export type ReviewQueue = Awaited<ReturnType<typeof reviewQueue>>;

/**
 * Os dois lados de um par para a tela "Confirmar o par" (o que fica de cada lado). null quando
 * a pessoa não edita os dois, o recebido já foi conferido ou os dois não formam par.
 */
export async function pairPreview(
  db: PrismaClient,
  scope: WalletScope<"edit">,
  input: { receivedId: string; ownId: string },
) {
  const walletIds = [...scope.walletIds];
  const [received, own] = await Promise.all([
    db.transaction.findFirst({
      where: {
        id: input.receivedId,
        walletId: { in: walletIds },
        status: "PENDING",
        deletedAt: null,
      },
      select: RECEIVED_SELECT,
    }),
    db.transaction.findFirst({
      where: {
        id: input.ownId,
        walletId: { in: walletIds },
        deletedAt: null,
        status: { in: ["SCHEDULED", "CONFIRMED"] },
        source: { not: "OPEN_FINANCE" },
      },
      select: OWN_SELECT,
    }),
  ]);
  if (!received || !own) return null;
  const candidate = pairCandidate(receivedForMatch(received), ownForMatch(own));
  if (!candidate) return null;
  const editable = new Set(walletIds);
  return {
    kind: candidate.kind,
    daysApart: candidate.daysApart,
    received: receivedView(received, editable),
    own: ownView(own),
    result: pairedFields(
      {
        cardId: received.cardId,
        categoryId: received.categoryId,
        categorizedBy: received.categorizedBy,
        categorizationConfidence: received.categorizationConfidence,
      },
      own,
    ),
  };
}

export type PairPreview = NonNullable<Awaited<ReturnType<typeof pairPreview>>>;

// ── Confirmar ───────────────────────────────────────────────────────────────────

/** NOT_FOUND quando a pessoa não alcança o recebido; REVIEW_STALE quando ele já foi conferido. */
async function staleOrMissing(db: Db, scope: WalletScope<"edit">, id: string): Promise<never> {
  const row = await db.transaction.findFirst({
    where: { id, walletId: { in: [...scope.walletIds] } },
    select: { id: true },
  });
  throw new DomainError(row ? "REVIEW_STALE" : "NOT_FOUND");
}

function householdOf(scope: WalletScope<"edit">): string {
  if (!scope.householdId) throw new DomainError("NOT_FOUND");
  return scope.householdId;
}

/**
 * Confirma um recebido (PENDING → CONFIRMED): ele passa a contar nas somas. Com `walletId`, no
 * ambiente escolhido na linha (precisa ser um que a pessoa edita).
 */
export async function confirmReceived(
  db: PrismaClient,
  scope: WalletScope<"edit">,
  input: { transactionId: string; walletId?: string | null },
  ctx: RequestContext,
  now: Date = new Date(),
) {
  const householdId = householdOf(scope);
  if (input.walletId && !scope.walletIds.includes(input.walletId))
    throw new DomainError("NOT_FOUND");
  await db.$transaction(async (tx) => {
    const { count } = await tx.transaction.updateMany({
      where: {
        id: input.transactionId,
        walletId: { in: [...scope.walletIds] },
        status: "PENDING",
        deletedAt: null,
      },
      data: {
        status: "CONFIRMED",
        reviewedAt: now,
        reviewedById: scope.userId,
        ...(input.walletId ? { walletId: input.walletId } : {}),
      },
    });
    if (count === 0) await staleOrMissing(tx, scope, input.transactionId);
    await writeAudit(
      tx,
      {
        actorId: scope.userId,
        householdId,
        action: "transaction.reviewed",
        entity: "transaction",
        entityId: input.transactionId,
        metadata: { walletChosen: Boolean(input.walletId) },
      },
      ctx,
    );
  });
  return { ids: [input.transactionId] };
}

/**
 * "Confirmar os N que já têm categoria": os recebidos com categoria (ou transferência) e SEM
 * par sugerido, de uma fatura, de uma conta ou de tudo. A lista é calculada aqui de novo (a tela
 * só diz o grupo): o que mudou entre a tela e o clique não entra por engano.
 */
export async function confirmBulk(
  db: PrismaClient,
  scope: WalletScope<"edit">,
  group: { accountId?: string | null; statementId?: string | null },
  ctx: RequestContext,
  now: Date = new Date(),
) {
  const householdId = householdOf(scope);
  return db.$transaction(async (tx) => {
    const rows = await tx.transaction.findMany({
      where: {
        walletId: { in: [...scope.walletIds] },
        status: "PENDING",
        deletedAt: null,
        ...(group.statementId
          ? { statementId: group.statementId }
          : group.accountId
            ? { accountId: group.accountId, statementId: null }
            : {}),
      },
      take: REVIEW_QUEUE_LIMIT,
      select: RECEIVED_SELECT,
    });
    const { suggestions } = await suggestionsFor(tx, scope.walletIds, rows);
    const ids = bulkConfirmable(rows, new Set(suggestions.map((s) => s.receivedId))).map(
      (r) => r.id,
    );
    if (ids.length === 0) return { ids: [] as string[] };
    const { count } = await tx.transaction.updateMany({
      where: { id: { in: ids }, status: "PENDING", deletedAt: null },
      data: { status: "CONFIRMED", reviewedAt: now, reviewedById: scope.userId },
    });
    await writeAudit(
      tx,
      {
        actorId: scope.userId,
        householdId,
        action: "transactions.reviewed_bulk",
        entity: group.accountId ? "financial_account" : "household",
        entityId: group.accountId ?? householdId,
        metadata: { count, statementId: group.statementId ?? null },
      },
      ctx,
    );
    return { ids };
  });
}

/**
 * O "Desfazer" de uma confirmação simples ou em lote: volta para Recebidos o que ESTA pessoa
 * confirmou nos últimos 30 minutos. Par e estorno têm o próprio desfazer (undoMatch).
 */
export async function undoReview(
  db: PrismaClient,
  scope: WalletScope<"edit">,
  ids: readonly string[],
  ctx: RequestContext,
  now: Date = new Date(),
) {
  const householdId = householdOf(scope);
  return db.$transaction(async (tx) => {
    const { count } = await tx.transaction.updateMany({
      where: {
        id: { in: [...ids] },
        walletId: { in: [...scope.walletIds] },
        status: "CONFIRMED",
        deletedAt: null,
        reviewedById: scope.userId,
        reviewedAt: { gte: new Date(now.getTime() - REVIEW_UNDO_MS) },
        matchesAsReceived: { none: { status: "CONFIRMED" } },
      },
      data: { status: "PENDING", reviewedAt: null, reviewedById: null },
    });
    if (count === 0) throw new DomainError("UNDO_EXPIRED");
    await writeAudit(
      tx,
      {
        actorId: scope.userId,
        householdId,
        action: "transaction.review_undone",
        entity: "household",
        entityId: householdId,
        metadata: { count },
      },
      ctx,
    );
    return { count };
  });
}

// ── Pares e estornos ────────────────────────────────────────────────────────────

/** O que o "Desfazer" de um par devolve ao recebido. */
type ReceivedBefore = {
  walletId: string;
  cardId: string | null;
  description: string;
  categoryId: string | null;
  categorizedBy: CategorizationSource | null;
  categorizationConfidence: number | null;
  notes: string | null;
  installmentGroupId: string | null;
  installmentNumber: number | null;
  recurrenceId: string | null;
  transferId: string | null;
  reversalOfId: string | null;
};

type OwnBefore = { installmentGroupId: string | null; installmentNumber: number | null };

const snapshotOf = (row: ReceivedRow): ReceivedBefore => ({
  walletId: row.walletId,
  cardId: row.cardId,
  description: row.description,
  categoryId: row.categoryId,
  categorizedBy: row.categorizedBy,
  categorizationConfidence: row.categorizationConfidence,
  notes: row.notes,
  installmentGroupId: row.installmentGroupId,
  installmentNumber: row.installmentNumber,
  recurrenceId: row.recurrenceId,
  transferId: row.transferId,
  reversalOfId: row.reversalOfId,
});

async function pendingReceived(tx: Db, scope: WalletScope<"edit">, id: string) {
  const row = await tx.transaction.findFirst({
    where: { id, walletId: { in: [...scope.walletIds] }, deletedAt: null },
    select: RECEIVED_SELECT,
  });
  if (!row) throw new DomainError("NOT_FOUND");
  if (row.status !== "PENDING") throw new DomainError("REVIEW_STALE");
  return row;
}

async function ownSide(tx: Db, scope: WalletScope<"edit">, id: string) {
  const row = await tx.transaction.findFirst({
    where: { id, walletId: { in: [...scope.walletIds] } },
    select: OWN_SELECT,
  });
  if (!row) throw new DomainError("NOT_FOUND");
  if (row.deletedAt) throw new DomainError("REVIEW_STALE");
  return row;
}

/**
 * Junta o par: fica o RECEBIDO (que tem o id do banco: a próxima busca o acha e não duplica),
 * com a descrição, a categoria, o ambiente, a observação, a parcela e a recorrência do SEU
 * lançamento; o seu fica apagado, apontando para ele (mergedIntoId). O valor e a data do banco
 * ficam. O antes dos dois lados vai para o TransactionMatch, para o "Desfazer".
 */
export async function confirmPair(
  db: PrismaClient,
  scope: WalletScope<"edit">,
  input: { receivedId: string; ownId: string },
  ctx: RequestContext,
  now: Date = new Date(),
) {
  const householdId = householdOf(scope);
  return db.$transaction(async (tx) => {
    const received = await pendingReceived(tx, scope, input.receivedId);
    const own = await ownSide(tx, scope, input.ownId);
    if (own.source === "OPEN_FINANCE" || own.status === "PENDING")
      throw new DomainError("PAIR_NOT_ALLOWED");
    const candidate = pairCandidate(receivedForMatch(received), ownForMatch(own));
    if (!candidate) throw new DomainError("PAIR_NOT_ALLOWED");

    const fields = pairedFields(
      {
        cardId: received.cardId,
        categoryId: received.categoryId,
        categorizedBy: received.categorizedBy,
        categorizationConfidence: received.categorizationConfidence,
      },
      own,
    );
    // O seu sai primeiro: a parcela (grupo, número) é única e passa para o recebido
    const ownUpdate = await tx.transaction.updateMany({
      where: { id: own.id, deletedAt: null },
      data: {
        deletedAt: now,
        mergedIntoId: received.id,
        installmentGroupId: null,
        installmentNumber: null,
      },
    });
    if (ownUpdate.count === 0) throw new DomainError("REVIEW_STALE");
    const receivedUpdate = await tx.transaction.updateMany({
      where: { id: received.id, status: "PENDING", deletedAt: null },
      data: {
        ...fields,
        categorizedBy: fields.categorizedBy as CategorizationSource | null,
        status: "CONFIRMED",
        reviewedAt: now,
        reviewedById: scope.userId,
      },
    });
    if (receivedUpdate.count === 0) throw new DomainError("REVIEW_STALE");
    const match = await tx.transactionMatch.create({
      data: {
        householdId,
        receivedId: received.id,
        ownId: own.id,
        kind: candidate.kind,
        status: "CONFIRMED",
        receivedBefore: snapshotOf(received),
        ownBefore: {
          installmentGroupId: own.installmentGroupId,
          installmentNumber: own.installmentNumber,
        } satisfies OwnBefore,
        decidedById: scope.userId,
        decidedAt: now,
      },
      select: { id: true },
    });
    await writeAudit(
      tx,
      {
        actorId: scope.userId,
        householdId,
        action: "transaction.paired",
        entity: "transaction",
        entityId: received.id,
        metadata: { ownId: own.id, kind: candidate.kind, matchId: match.id },
      },
      ctx,
    );
    return { matchId: match.id, kind: candidate.kind };
  });
}

/** "Não é o mesmo": grava a recusa; a sugestão não volta (nem para outra pessoa do lar). */
export async function rejectPair(
  db: PrismaClient,
  scope: WalletScope<"edit">,
  input: { receivedId: string; ownId: string },
  ctx: RequestContext,
  now: Date = new Date(),
) {
  const householdId = householdOf(scope);
  await db.$transaction(async (tx) => {
    const received = await pendingReceived(tx, scope, input.receivedId);
    const own = await ownSide(tx, scope, input.ownId);
    const amount = fromDbDecimal(received.amount);
    const kind: MatchKind =
      amount > 0n && fromDbDecimal(own.amount) === -amount
        ? "REFUND"
        : (pairCandidate(receivedForMatch(received), ownForMatch(own))?.kind ?? "SAME");
    await tx.transactionMatch.create({
      data: {
        householdId,
        receivedId: received.id,
        ownId: own.id,
        kind,
        status: "REJECTED",
        decidedById: scope.userId,
        decidedAt: now,
      },
    });
    await writeAudit(
      tx,
      {
        actorId: scope.userId,
        householdId,
        action: "transaction.pair_rejected",
        entity: "transaction",
        entityId: received.id,
        metadata: { ownId: own.id, kind },
      },
      ctx,
    );
  });
}

/**
 * "Ligar ao original": o crédito do banco vira o estorno da compra (reversalOfId), entra no
 * ambiente dela e fica confirmado. A categoria não é copiada: a compra tem categoria de despesa
 * e o estorno é entrada (a regra do M07 não deixa misturar); fica a que o recebido já tinha.
 */
export async function linkRefund(
  db: PrismaClient,
  scope: WalletScope<"edit">,
  input: { receivedId: string; originalId: string },
  ctx: RequestContext,
  now: Date = new Date(),
) {
  const householdId = householdOf(scope);
  return db.$transaction(async (tx) => {
    const received = await pendingReceived(tx, scope, input.receivedId);
    const original = await ownSide(tx, scope, input.originalId);
    const reversed = await tx.transaction.count({
      where: { reversalOfId: original.id, deletedAt: null },
    });
    if (
      original.status !== "CONFIRMED" ||
      original.transferId !== null ||
      reversed > 0 ||
      suggestRefunds([receivedForMatch(received)], [refundTarget(original)]).length !== 1
    ) {
      throw new DomainError("REFUND_NOT_ALLOWED");
    }
    const { count } = await tx.transaction.updateMany({
      where: { id: received.id, status: "PENDING", deletedAt: null },
      data: {
        reversalOfId: original.id,
        walletId: original.walletId,
        status: "CONFIRMED",
        reviewedAt: now,
        reviewedById: scope.userId,
      },
    });
    if (count === 0) throw new DomainError("REVIEW_STALE");
    const match = await tx.transactionMatch.create({
      data: {
        householdId,
        receivedId: received.id,
        ownId: original.id,
        kind: "REFUND",
        status: "CONFIRMED",
        receivedBefore: snapshotOf(received),
        decidedById: scope.userId,
        decidedAt: now,
      },
      select: { id: true },
    });
    await writeAudit(
      tx,
      {
        actorId: scope.userId,
        householdId,
        action: "transaction.refund_linked",
        entity: "transaction",
        entityId: received.id,
        metadata: { originalId: original.id, matchId: match.id },
      },
      ctx,
    );
    return { matchId: match.id };
  });
}

function parseReceivedBefore(value: Prisma.JsonValue | null): ReceivedBefore {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new DomainError("UNDO_EXPIRED");
  const v = value as Record<string, unknown>;
  const str = (k: string) => (typeof v[k] === "string" ? (v[k] as string) : null);
  const walletId = str("walletId");
  const description = str("description");
  if (!walletId || !description) throw new DomainError("UNDO_EXPIRED");
  return {
    walletId,
    description,
    cardId: str("cardId"),
    categoryId: str("categoryId"),
    categorizedBy: str("categorizedBy") as CategorizationSource | null,
    // Desfazer de um par confirmado antes do M10.1 não tem a confiança: fica sem
    categorizationConfidence:
      typeof v.categorizationConfidence === "number" ? v.categorizationConfidence : null,
    notes: str("notes"),
    installmentGroupId: str("installmentGroupId"),
    installmentNumber: typeof v.installmentNumber === "number" ? v.installmentNumber : null,
    recurrenceId: str("recurrenceId"),
    transferId: str("transferId"),
    reversalOfId: str("reversalOfId"),
  };
}

function parseOwnBefore(value: Prisma.JsonValue | null): OwnBefore {
  const v = (value && typeof value === "object" && !Array.isArray(value) ? value : {}) as Record<
    string,
    unknown
  >;
  return {
    installmentGroupId: typeof v.installmentGroupId === "string" ? v.installmentGroupId : null,
    installmentNumber: typeof v.installmentNumber === "number" ? v.installmentNumber : null,
  };
}

/**
 * Desfaz um par ou um estorno: o recebido volta a ser recebido (como estava antes) e o seu
 * lançamento volta da lixeira. Só quem decidiu desfaz, e só enquanto o recebido não mudou de
 * novo (continua confirmado).
 */
export async function undoMatch(
  db: PrismaClient,
  scope: WalletScope<"edit">,
  matchId: string,
  ctx: RequestContext,
  now: Date = new Date(),
) {
  const householdId = householdOf(scope);
  await db.$transaction(async (tx) => {
    const match = await tx.transactionMatch.findFirst({
      where: {
        id: matchId,
        householdId,
        decidedById: scope.userId,
        received: { walletId: { in: [...scope.walletIds] } },
      },
      select: {
        id: true,
        kind: true,
        status: true,
        receivedId: true,
        ownId: true,
        receivedBefore: true,
        ownBefore: true,
      },
    });
    if (!match) throw new DomainError("NOT_FOUND");
    if (match.status !== "CONFIRMED") throw new DomainError("UNDO_EXPIRED");
    const before = parseReceivedBefore(match.receivedBefore);
    // O recebido larga a parcela primeiro: ela volta para o seu lançamento
    const received = await tx.transaction.updateMany({
      where: { id: match.receivedId, status: "CONFIRMED", deletedAt: null },
      data: { ...before, status: "PENDING", reviewedAt: null, reviewedById: null },
    });
    if (received.count === 0) throw new DomainError("UNDO_EXPIRED");
    if (match.kind !== "REFUND") {
      const own = parseOwnBefore(match.ownBefore);
      const restored = await tx.transaction.updateMany({
        where: { id: match.ownId, mergedIntoId: match.receivedId },
        data: { deletedAt: null, mergedIntoId: null, ...own },
      });
      if (restored.count === 0) throw new DomainError("UNDO_EXPIRED");
    }
    await tx.transactionMatch.update({
      where: { id: match.id },
      data: { status: "UNDONE", undoneAt: now },
    });
    await writeAudit(
      tx,
      {
        actorId: scope.userId,
        householdId,
        action: "transaction.match_undone",
        entity: "transaction",
        entityId: match.receivedId,
        metadata: { matchId: match.id, kind: match.kind },
      },
      ctx,
    );
  });
}

// ── Cartões adicionais ──────────────────────────────────────────────────────────

/**
 * Depois de cadastrar (ou arquivar) um cartão: os RECEBIDOS da conta vão para o cartão do final
 * que o banco mandou e, se ainda estavam no ambiente que o cartão antigo daria, para o ambiente
 * do cartão novo (portador ou "Compras importadas entram em"). O que já foi confirmado não muda.
 * Recebe o cliente da transação de quem cadastrou. Devolve quantos mudaram.
 */
export async function rerouteReceived(tx: Db, accountId: string): Promise<number> {
  const account = await tx.financialAccount.findUnique({
    where: { id: accountId },
    select: {
      householdId: true,
      walletId: true,
      holderId: true,
      kind: true,
      cards: {
        where: { archivedAt: null },
        select: { id: true, lastFour: true, holderId: true, importWalletId: true },
      },
    },
  });
  if (!account || account.kind !== "CREDIT_CARD") return 0;
  const rows = await tx.transaction.findMany({
    where: { accountId, status: "PENDING", deletedAt: null, providerCardLastFour: { not: null } },
    select: { id: true, walletId: true, cardId: true, providerCardLastFour: true },
  });
  if (rows.length === 0) return 0;
  const personalWallets = await personalWalletsOf(tx, account.householdId);
  const walletFor = (card: (typeof account.cards)[number] | null) =>
    importWalletFor({ account, card, personalWallets });
  let moved = 0;
  for (const row of rows) {
    const card = cardForLastFour(account.cards, row.providerCardLastFour);
    if ((card?.id ?? null) === row.cardId) continue;
    await tx.transaction.update({
      where: { id: row.id },
      data: { cardId: card?.id ?? null, ...rerouteWallet(row, account, card, walletFor) },
    });
    moved += 1;
  }
  return moved;
}

export type { MatchSuggestion };
