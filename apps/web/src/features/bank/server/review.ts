// Leituras da revisão dos recebidos (M09.2, linha E.2 do canvas). Tudo parte do escopo de quem
// está logado: a fila mostra o que a pessoa vê; pares, estornos e "Confirmar" só onde ela edita.
import "server-only";
import { canInHousehold, householdPeople } from "@fintrack/core";
import {
  authorizeAccountView,
  authorizeWallet,
  explainTransaction,
  isUuid,
  localAiProposalPreview,
  pairPreview,
  prisma,
  reviewQueue,
} from "@fintrack/db";
import { AccessError, requireHouseholdAccess, requireScope } from "@/lib/access";
import type { Session } from "@/lib/auth";
import { cascadeServices } from "@/lib/ml/classifier";
import type { ReviewView } from "../schemas";
import { categoryChoices, myConnectionGrant } from "./queries";

/** "Banco atualizado às … · buscado às …" da conexão de quem está logado. */
async function syncInfo(session: Session) {
  const grant = await myConnectionGrant(session);
  if (!grant?.connectionId) return { bankUpdatedAt: null, lastSyncedAt: null, canSync: false };
  const connection = await prisma.providerConnection.findUnique({
    where: { id: grant.connectionId },
    select: { lastSyncedAt: true, items: { select: { bankUpdatedAt: true } } },
  });
  const bankUpdatedAt =
    connection?.items
      .map((i) => i.bankUpdatedAt)
      .filter((d): d is Date => d !== null)
      .sort((a, b) => b.getTime() - a.getTime())[0] ?? null;
  return { bankUpdatedAt, lastSyncedAt: connection?.lastSyncedAt ?? null, canSync: true };
}

export async function getReviewPage(session: Session, view: ReviewView) {
  const [scope, edit] = await Promise.all([
    requireScope(session, "view"),
    requireScope(session, "edit"),
  ]);
  const [queue, categories, wallets, sync, canManageCategories] = await Promise.all([
    reviewQueue(prisma, scope, edit),
    categoryChoices(session),
    prisma.wallet.findMany({
      where: { id: { in: [...edit.walletIds] }, archivedAt: null },
      orderBy: [{ kind: "asc" }, { name: "asc" }],
      select: { id: true, name: true },
    }),
    syncInfo(session),
    canManageCategoriesOf(session),
  ]);
  // O filtro só escolhe o que aparece; os números do topo são sempre os da fila inteira
  const groups =
    view === "pares"
      ? []
      : queue.groups
          .map((g) => ({
            ...g,
            items:
              view === "sem-categoria"
                ? g.items.filter((i) => !i.category && !i.isTransfer)
                : view === "fila-ia"
                  ? g.items.filter((i) => i.localAi.queued)
                  : g.items,
          }))
          .filter((g) => g.items.length > 0);
  return {
    queue,
    view,
    pairs: view === "sem-categoria" || view === "fila-ia" ? [] : queue.pairs,
    /** M13.2: as transferências sugeridas aparecem com os pares */
    transfers: view === "sem-categoria" || view === "fila-ia" ? [] : queue.transfers,
    groups,
    categories,
    wallets,
    sync,
    /** M10.2b: o "Criar e aplicar" da categoria nova só aparece para quem mexe nas categorias */
    canManageCategories,
  };
}

/** Quem pode criar categoria no lar (o "Criar e aplicar" da IA local). */
async function canManageCategoriesOf(session: Session) {
  try {
    const grant = await requireHouseholdAccess(session, "view");
    return canInHousehold(grant.role, "manage_categories");
  } catch (error) {
    if (error instanceof AccessError) return false;
    throw error;
  }
}

/**
 * "Criar e aplicar" a categoria que a IA local propôs (M10.2b, pranchas F2-Recebidos e
 * F2-CelCriar). null = não há proposta (já resolvida, carteira que a pessoa não edita) ou a
 * pessoa não mexe nas categorias do lar.
 */
export async function getProposalPage(session: Session, transactionId: string) {
  if (!isUuid(transactionId) || !(await canManageCategoriesOf(session))) return null;
  const edit = await requireScope(session, "edit");
  return localAiProposalPreview(prisma, edit, transactionId);
}

export type ProposalPage = NonNullable<Awaited<ReturnType<typeof getProposalPage>>>;

export type ReviewPage = Awaited<ReturnType<typeof getReviewPage>>;

/** "Confirmar o par": os dois lados e o resultado. null = não há par (já conferido, ou nunca foi). */
export async function getPairPage(session: Session, receivedId: string, ownId: string) {
  if (!isUuid(receivedId) || !isUuid(ownId)) return null;
  const edit = await requireScope(session, "edit");
  return pairPreview(prisma, edit, { receivedId, ownId });
}

/**
 * "Por que essa categoria?" de um recebido (M10.1, pranchas F-Sugestoes e F-CelSugestoes): a
 * cascata de hoje, camada por camada, vista por quem pergunta (as carteiras que ela vê, os
 * modelos dessas carteiras). "Confirmar" só para quem edita a carteira do recebido.
 */
export async function getExplanationPage(session: Session, transactionId: string) {
  const [scope, edit] = await Promise.all([
    requireScope(session, "view"),
    requireScope(session, "edit"),
  ]);
  const explanation = await explainTransaction(
    prisma,
    scope,
    transactionId,
    cascadeServices(session.user.id),
  );
  if (!explanation) return null;
  const t = explanation.transaction;
  return {
    ...explanation,
    canConfirm: t.pending && t.category !== null && edit.walletIds.includes(t.walletId),
  };
}

export type ExplanationPage = NonNullable<Awaited<ReturnType<typeof getExplanationPage>>>;

/**
 * A conta em Ajustes › Contas (M09.2, prancha E2-Finais): os cartões e os finais que o banco
 * mandou e não estão cadastrados. Quem vê a carteira da conta vê; quem gere contas cadastra.
 */
export async function getAccountCardsPage(session: Session, accountId: string) {
  const access = await authorizeAccountView(prisma, session.user.id, accountId);
  if (!access.ok) throw new AccessError("NOT_FOUND");
  const account = access.grant.account;
  const [details, manage, members, pending] = await Promise.all([
    prisma.financialAccount.findUniqueOrThrow({
      where: { id: account.id },
      select: {
        name: true,
        kind: true,
        closingDay: true,
        dueDay: true,
        institution: true,
        walletId: true,
        holderId: true,
        connection: { select: { items: { select: { institution: true } } } },
        cards: {
          orderBy: [{ archivedAt: { sort: "asc", nulls: "first" } }, { createdAt: "asc" }],
          select: {
            id: true,
            nickname: true,
            brand: true,
            lastFour: true,
            form: true,
            isAdditional: true,
            sharedPurchases: true,
            archivedAt: true,
            holderId: true,
            holder: { select: { name: true } },
            importWallet: { select: { name: true, kind: true } },
          },
        },
      },
    }),
    authorizeWallet(prisma, session.user.id, access.grant.wallet.wallet.id, "manage_accounts"),
    prisma.householdMember.findMany({
      where: { householdId: access.grant.wallet.wallet.householdId },
      orderBy: { joinedAt: "asc" },
      select: { userId: true, joinedAt: true, user: { select: { name: true } } },
    }),
    // Os recebidos sem cartão com o final que o banco mandou (de qualquer ambiente: o titular vê
    // a fatura inteira, regra do M04)
    prisma.transaction.groupBy({
      by: ["providerCardLastFour"],
      where: {
        accountId: account.id,
        status: "PENDING",
        deletedAt: null,
        cardId: null,
        providerCardLastFour: { not: null },
      },
      _count: { _all: true },
    }),
  ]);
  const registered = new Set(details.cards.filter((c) => !c.archivedAt).map((c) => c.lastFour));
  return {
    account: { id: account.id, ...details },
    institution:
      details.institution ??
      details.connection?.items.find((i) => i.institution)?.institution ??
      null,
    canManage: manage.ok,
    // Com as iniciais e a cor do "Pago por" (M13.1: quem usa cada cartão)
    people: householdPeople(members),
    me: session.user.id,
    finals: pending
      .filter((p) => p.providerCardLastFour && !registered.has(p.providerCardLastFour))
      .map((p) => ({ lastFour: p.providerCardLastFour as string, count: p._count._all })),
  };
}

// Os tipos que as telas da revisão usam (o ui/ não importa o @fintrack/db, regra do ESLint)
export type {
  PairPreview,
  PairView,
  ReceivedView,
  ReviewGroup,
  TransferSideView,
  TransferView,
} from "@fintrack/db";
