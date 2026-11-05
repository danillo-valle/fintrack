// Leituras das telas de lançamento (M07). Tudo parte de um crachá: escopo de carteiras para a
// lista, crachá do lançamento para o detalhe. Nenhuma consulta recebe um id solto da URL.
import "server-only";
import {
  addMonthsToKey,
  canInHousehold,
  householdPeople,
  monthOf,
  SHARED_INITIALS,
  SHARED_PAYER_PARAM,
  SHARED_TONE,
  todayCivil,
  type CivilDate,
  type MonthKey,
} from "@fintrack/core";
import {
  accountBalances,
  accountForecast,
  arrivalsVsExpected,
  getTransaction,
  installmentPurchases,
  lastUsedChoice,
  listCategories,
  listHouseholdMembers,
  listMyWallets,
  entryTypeView,
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

/** Quantos meses à frente a lista de uma conta mostra as previstas (o período pode ser longo). */
const FORECAST_LIST_MONTHS = 12;

/** Os meses do período que vão de hoje em diante (o mês de hoje entra: o que ainda falta nele). */
function forecastMonths(bounds: { from: CivilDate; to: CivilDate }, today: CivilDate): MonthKey[] {
  const current = monthOf(today);
  const first = monthOf(bounds.from) > current ? monthOf(bounds.from) : current;
  const months: MonthKey[] = [];
  for (let m = first; m <= monthOf(bounds.to) && months.length < FORECAST_LIST_MONTHS;) {
    months.push(m);
    m = addMonthsToKey(m, 1);
  }
  return months;
}

/**
 * As previstas de uma conta nos meses pedidos (O-ContaPrevista) e, no mês de hoje, o que chegou
 * das recorrências do banco e quanto veio diferente do previsto (O-CelReceita).
 */
async function accountForecastOf(
  scope: WalletScope<"view">,
  accountId: string,
  months: MonthKey[],
  today: CivilDate,
) {
  if (months.length === 0) return null;
  const current = monthOf(today);
  const [list, arrivals] = await Promise.all([
    accountForecast(prisma, scope, accountId, months, today),
    months.includes(current)
      ? arrivalsVsExpected(prisma, scope, accountId, current)
      : Promise.resolve([]),
  ]);
  return {
    months: list.map((m) => ({ ...m, current: m.month === current })),
    arrivals: arrivals.filter((a) => a.amount !== a.expected),
  };
}

export type AccountForecastView = NonNullable<Awaited<ReturnType<typeof accountForecastOf>>>;

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
  let forecast: AccountForecastView | null = null;
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
      const months = forecastMonths(bounds, today);
      [main, forecast] = await Promise.all([
        listPart(
          scope,
          { ...base, accountId: account.id, side: "accounts" },
          parsed.cursor,
          canEdit,
        ),
        accountForecastOf(scope, account.id, months, today),
      ]);
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
    /** Os meses do período de hoje em diante, com as previstas da conta (M13.3c) */
    forecast,
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
    return { transaction, form: null, entryType: null };
  }
  const [entry, entryType] = await Promise.all([
    getQuickEntryPage(session),
    entryTypeView(prisma, grant),
  ]);
  return { transaction, form: entry, entryType: entryType.choosable ? entryType : null };
}

/** O tipo de um lançamento que já existe, como a tela recebe (M13.3c). */
export type { EntryTypeView } from "@fintrack/db";

/** O que Fixas e parcelas mostra: tudo, ou só uma parte (`?mostrar=`, canvas O-Fixas). */
export const FIXED_TABS = ["entradas", "saidas", "parceladas"] as const;
export type FixedTab = (typeof FIXED_TABS)[number];

/**
 * Fixas e parcelas (M13.3a; M13.3c, canvas O-Fixas): as recorrências das carteiras que a pessoa vê
 * (entradas e saídas fixas, com o valor previsto pela regra de cada uma e as últimas que chegaram)
 * e as compras parceladas em andamento, com o que ainda falta pagar. `?mudada=` marca a recorrência
 * que acabou de mudar (o aviso no topo).
 */
export async function getFixedPage(
  session: Session,
  params: Record<string, string | string[] | undefined> = {},
  today: CivilDate = todayCivil(),
) {
  const one = (value: string | string[] | undefined) =>
    (Array.isArray(value) ? value[0] : value)?.trim() || null;
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
  const tab = FIXED_TABS.find((t) => t === one(params.mostrar)) ?? null;
  const changed = rows.find((r) => r.id === one(params.mudada)) ?? null;
  return {
    today,
    tab,
    changed: changed ? { id: changed.id, name: changed.description } : null,
    income: rows.filter((r) => r.kind === "INCOME"),
    expense: rows.filter((r) => r.kind !== "INCOME"),
    installments,
    canCreate: editable.size > 0,
  };
}

export type FixedRecurrence = Awaited<ReturnType<typeof getFixedPage>>["expense"][number];

/**
 * Mudar o valor (Fixas e parcelas, ⋯): uma recorrência ativa de uma carteira em que a pessoa pode
 * lançar. Outra pessoa, encerrada ou inventada: null (a página responde 404).
 */
export async function getRecurrenceEditPage(session: Session, recurrenceId: string) {
  const page = await getFixedPage(session);
  const recurrence = [...page.income, ...page.expense].find(
    (r) => r.id === recurrenceId && r.canEdit && !r.archivedAt,
  );
  return recurrence ?? null;
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
