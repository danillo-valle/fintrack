// Leituras das telas de lançamento (M07). Tudo parte de um crachá: escopo de carteiras para a
// lista, crachá do lançamento para o detalhe. Nenhuma consulta recebe um id solto da URL.
import "server-only";
import { canInHousehold, todayCivil, type CivilDate } from "@fintrack/core";
import {
  getTransaction,
  lastUsedChoice,
  listCategories,
  listMyWallets,
  listRecurrences,
  listTransactions,
  listUsableAccounts,
  prisma,
  sumTransactions,
} from "@fintrack/db";
import {
  AccessError,
  notFoundOnDenied,
  requireHouseholdAccess,
  requireScope,
  requireTransactionAccess,
} from "@/lib/access";
import type { Session } from "@/lib/auth";
import { parseFilters } from "../schemas";

type SearchParams = Record<string, string | string[] | undefined>;

/** As categorias ativas do lar (vazio se a pessoa ainda não tem lar). */
async function categoriesOf(session: Session) {
  try {
    const grant = await requireHouseholdAccess(session, "view");
    return {
      categories: await listCategories(prisma, grant),
      canManageCategories: canInHousehold(grant.role, "manage_categories"),
    };
  } catch (error) {
    if (error instanceof AccessError) return { categories: [], canManageCategories: false };
    throw error;
  }
}

/** As carteiras em que a pessoa pode lançar (dona ou editora, não arquivadas). */
async function editableWallets(session: Session) {
  const wallets = await listMyWallets(prisma, session.user.id);
  return wallets
    .filter((w) => w.role !== "VIEWER" && !w.archived)
    .map((w) => ({ id: w.id, name: w.name, kind: w.kind }));
}

/**
 * O que o lançamento rápido precisa: carteiras, contas (com cartões), categorias e os valores
 * padrão (a carteira e a conta do último lançamento, se ainda valem).
 */
export async function getQuickEntryPage(session: Session) {
  const [wallets, accounts, cats, last] = await Promise.all([
    editableWallets(session),
    listUsableAccounts(prisma, session.user.id),
    categoriesOf(session),
    lastUsedChoice(prisma, session.user.id),
  ]);
  const walletId = wallets.find((w) => w.id === last?.walletId)?.id ?? wallets[0]?.id ?? null;
  const accountId = accounts.find((a) => a.id === last?.accountId)?.id ?? accounts[0]?.id ?? null;
  return {
    wallets,
    accounts,
    categories: cats.categories,
    canManageCategories: cats.canManageCategories,
    defaults: { walletId, accountId, occurredOn: todayCivil() },
  };
}

/** A lista: filtros da URL, uma página, os totais do filtro e as opções dos filtros. */
export async function getTransactionsPage(
  session: Session,
  params: SearchParams,
  today?: CivilDate,
) {
  const parsed = parseFilters(params, today ?? todayCivil());
  const scope = await requireScope(session, "view", parsed.walletId);
  const [page, totals, wallets, accounts, cats] = await Promise.all([
    listTransactions(prisma, scope, parsed.filters, parsed.cursor),
    sumTransactions(prisma, scope, parsed.filters),
    listMyWallets(prisma, session.user.id),
    listUsableAccounts(prisma, session.user.id),
    categoriesOf(session),
  ]);
  const canEdit = new Set(
    wallets.filter((w) => w.role !== "VIEWER" && !w.archived).map((w) => w.id),
  );
  return {
    parsed,
    items: page.items.map((item) => ({ ...item, canEdit: canEdit.has(item.wallet.id) })),
    nextCursor: page.nextCursor,
    totals,
    options: {
      wallets: wallets.map((w) => ({ id: w.id, name: w.name })),
      accounts: accounts.map((a) => ({ id: a.id, name: a.name })),
      categories: cats.categories.map((c) => ({ id: c.id, name: c.name })),
    },
    hasWallets: wallets.length > 0,
    canExport: wallets.some((w) => w.role === "OWNER" && !w.archived),
  };
}

/**
 * O detalhe de /lancamentos/[id]. Qualquer recusa vira a página 404: lançamento de outra
 * pessoa, inexistente ou com id fora do formato dão a mesma resposta.
 */
export async function getTransactionPage(session: Session, transactionId: string) {
  const grant = await requireTransactionAccess(session, transactionId, "view").catch(
    notFoundOnDenied,
  );
  const transaction = await getTransaction(prisma, grant);
  if (!transaction.canEdit || transaction.transferId) {
    return { transaction, form: null };
  }
  const entry = await getQuickEntryPage(session);
  return { transaction, form: entry };
}

/** A tela de recorrências: as das carteiras que a pessoa vê, e o que o formulário precisa. */
export async function getRecurrencesPage(session: Session) {
  const scope = await requireScope(session, "view");
  const [recurrences, entry] = await Promise.all([
    listRecurrences(prisma, scope),
    getQuickEntryPage(session),
  ]);
  const editable = new Set(entry.wallets.map((w) => w.id));
  return {
    recurrences: recurrences.map((r) => ({ ...r, canEdit: editable.has(r.walletId) })),
    entry,
  };
}

/** A tela de exportação: só as carteiras em que a pessoa é dona (export). */
export async function getExportPage(session: Session) {
  const wallets = await listMyWallets(prisma, session.user.id);
  return {
    wallets: wallets
      .filter((w) => w.role === "OWNER" && !w.archived)
      .map((w) => ({ id: w.id, name: w.name })),
  };
}
