// Leituras das telas de lançamento (M07). Tudo parte de um crachá: escopo de carteiras para a
// lista, crachá do lançamento para o detalhe. Nenhuma consulta recebe um id solto da URL.
import "server-only";
import {
  canInHousehold,
  householdPeople,
  SHARED_INITIALS,
  SHARED_PAYER_PARAM,
  SHARED_TONE,
  todayCivil,
  type CivilDate,
} from "@fintrack/core";
import {
  accountBalances,
  getTransaction,
  installmentPurchases,
  lastUsedChoice,
  listCategories,
  listHouseholdMembers,
  listMyWallets,
  listRecurrences,
  listTransactions,
  listUsableAccounts,
  prisma,
  receivedSummary,
  sumTransactions,
  type TransactionFilters,
  type WalletScope,
} from "@fintrack/db";
import {
  AccessError,
  notFoundOnDenied,
  requireHouseholdAccess,
  requireScope,
  requireTransactionAccess,
} from "@/lib/access";
import type { Session } from "@/lib/auth";
import { environmentsOf } from "../environments";
import type { PayerOption } from "../payers";
import {
  hasSliceFilters,
  listView,
  parseFilters,
  periodBounds,
  periodRanges,
  type ListFilters,
} from "../schemas";

/** Os filtros da URL no formato do @fintrack/db (o período vira os dias de cada mês marcado). */
export function dbFilters(filters: ListFilters): TransactionFilters {
  const { period, payers, upTo, ...rest } = filters;
  return { ...rest, periods: periodRanges(period), occurredUntil: upTo, payers };
}

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

/**
 * As pessoas do lar para "Pago por", pela ordem em que entraram (é ela que decide a cor), e o
 * Compartilhado no fim. Sem lar, lista vazia.
 */
export async function payersOf(session: Session): Promise<PayerOption[]> {
  try {
    const grant = await requireHouseholdAccess(session, "view");
    const people = householdPeople(await listHouseholdMembers(prisma, grant));
    return [
      ...people.map((p) => ({
        param: p.userId,
        name: p.firstName,
        initials: p.initials,
        tone: p.tone,
      })),
      {
        param: SHARED_PAYER_PARAM,
        name: "Compartilhado",
        initials: SHARED_INITIALS,
        tone: SHARED_TONE,
      },
    ];
  } catch (error) {
    if (error instanceof AccessError) return [];
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
  const [wallets, accounts, cats, last, payers] = await Promise.all([
    editableWallets(session),
    listUsableAccounts(prisma, session.user.id),
    categoriesOf(session),
    lastUsedChoice(prisma, session.user.id),
    payersOf(session),
  ]);
  const walletId = wallets.find((w) => w.id === last?.walletId)?.id ?? wallets[0]?.id ?? null;
  const accountId = accounts.find((a) => a.id === last?.accountId)?.id ?? accounts[0]?.id ?? null;
  return {
    wallets,
    accounts,
    categories: cats.categories,
    canManageCategories: cats.canManageCategories,
    defaults: { walletId, accountId, occurredOn: todayCivil() },
    payers,
  };
}

/** Uma parte da lista: uma página, o cursor da próxima e os totais (o mesmo WHERE). */
async function listPart(
  scope: WalletScope<"view">,
  filters: TransactionFilters,
  cursor: string | null,
  canEdit: ReadonlySet<string>,
) {
  const [page, totals] = await Promise.all([
    listTransactions(prisma, scope, filters, cursor),
    sumTransactions(prisma, scope, filters),
  ]);
  return {
    items: page.items.map((item) => ({ ...item, canEdit: canEdit.has(item.wallet.id) })),
    nextCursor: page.nextCursor,
    totals,
  };
}

export type ListPart = Awaited<ReturnType<typeof listPart>>;

/**
 * Lançamentos (M07; separados no M13.3a, ADR-025). Três jeitos, pelo `listView`:
 *   account   uma conta que não é cartão, com o saldo; sem conta na URL, a primeira (a corrente)
 *   slice     o recorte de um número do painel em duas partes: as contas e os cartões
 *   received  a fila do banco (M09.1)
 * Uma conta de cartão na URL vai para Cartões (`cardRedirect`).
 */
export async function getTransactionsPage(
  session: Session,
  params: SearchParams,
  today: CivilDate = todayCivil(),
) {
  const parsed = parseFilters(params, today);
  let view = listView(parsed);
  const [scope, everything] = await Promise.all([
    requireScope(session, "view", parsed.walletId),
    requireScope(session, "view"),
  ]);
  const bounds = periodBounds(parsed.filters.period);
  const [wallets, cats, payers, received, accounts] = await Promise.all([
    listMyWallets(prisma, session.user.id),
    categoriesOf(session),
    payersOf(session),
    // M09.1: quantos recebidos do banco esperam revisão (ficam fora desta lista e dos totais)
    receivedSummary(prisma, scope.walletIds),
    // As contas que não são cartão (as abas), com o saldo: de todos os ambientes que a pessoa vê
    accountBalances(prisma, everything, { today, periodStart: bounds.from }),
  ]);
  const canEdit = new Set(
    wallets.filter((w) => w.role !== "VIEWER" && !w.archived).map((w) => w.id),
  );
  const base = dbFilters(parsed.filters);

  let account: (typeof accounts)[number] | null = null;
  let cardRedirect: string | null = null;
  let main: ListPart | null = null;
  let cards: ListPart | null = null;
  if (view === "account") {
    const requested = parsed.filters.accountId;
    account = requested
      ? (accounts.find((a) => a.id === requested) ?? null)
      : (accounts[0] ?? null);
    if (requested && !account) {
      const card = await prisma.financialAccount.findFirst({
        where: { id: requested, kind: "CREDIT_CARD", walletId: { in: [...everything.walletIds] } },
        select: { id: true },
      });
      // Um cartão: sem outro filtro, a página dele em Cartões; com (o detalhe do Fluxo de caixa),
      // o recorte, em que só a parte dos cartões tem algo
      if (card && hasSliceFilters(parsed)) view = "slice";
      else if (card) cardRedirect = `/cartoes?conta=${card.id}`;
    }
    if (view === "account" && account) {
      main = await listPart(
        scope,
        { ...base, accountId: account.id, side: "accounts" },
        parsed.cursor,
        canEdit,
      );
    }
  }
  if (view === "slice") {
    [main, cards] = await Promise.all([
      listPart(scope, { ...base, side: "accounts" }, parsed.cursor, canEdit),
      listPart(scope, { ...base, side: "cards" }, parsed.cardCursor, canEdit),
    ]);
  } else if (view === "received") {
    main = await listPart(scope, base, parsed.cursor, canEdit);
  }

  return {
    parsed,
    view,
    today,
    account,
    accounts,
    cardRedirect,
    /** A lista principal: a da conta, a parte das contas no recorte ou a fila do banco */
    main,
    /** A parte dos cartões no recorte do painel */
    cards,
    options: {
      wallets: wallets.map((w) => ({ id: w.id, name: w.name })),
      accounts: accounts.map((a) => ({ id: a.id, name: a.name })),
      categories: cats.categories.map((c) => ({ id: c.id, name: c.name })),
    },
    hasWallets: wallets.length > 0,
    canExport: wallets.some((w) => w.role === "OWNER" && !w.archived),
    /** O seletor de ambiente: os que a pessoa vê, compartilhados primeiro */
    environments: environmentsOf(wallets),
    payers,
    received,
    /** As outras pessoas do lar (primeiro nome): o pessoal delas fica de fora da soma */
    otherMembers: payers
      .filter((p) => p.param !== SHARED_PAYER_PARAM && p.param !== session.user.id)
      .map((p) => p.name),
  };
}

export type TransactionsPage = Awaited<ReturnType<typeof getTransactionsPage>>;

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

/**
 * Fixas e parcelas (M13.3a, item do menu): as recorrências das carteiras que a pessoa vê (entradas
 * e saídas fixas) e as compras parceladas em andamento, com o que ainda falta pagar.
 */
export async function getFixedPage(session: Session, today: CivilDate = todayCivil()) {
  const scope = await requireScope(session, "view");
  const [recurrences, installments, wallets] = await Promise.all([
    listRecurrences(prisma, scope),
    installmentPurchases(prisma, scope, today),
    listMyWallets(prisma, session.user.id),
  ]);
  const editable = new Set(
    wallets.filter((w) => w.role !== "VIEWER" && !w.archived).map((w) => w.id),
  );
  const rows = recurrences.map((r) => ({ ...r, canEdit: editable.has(r.walletId) }));
  return {
    today,
    income: rows.filter((r) => r.kind === "INCOME"),
    expense: rows.filter((r) => r.kind !== "INCOME"),
    installments,
    canCreate: editable.size > 0,
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
