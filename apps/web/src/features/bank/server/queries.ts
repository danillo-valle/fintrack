// Leituras das telas da coleta bancária (M09.1). Toda leitura parte de um crachá: a conexão é
// sempre a de quem está logado (ConnectionGrant), a conta do cartão passa por authorizeAccountView
// e o Início usa o escopo das carteiras que a pessoa vê.
import "server-only";
import {
  addDays,
  addMonthsToKey,
  firstDayOf,
  defaultStatement,
  futureStatements,
  statementOfMonth,
  statementState,
  statementWindow,
  householdPeople,
  monthOf,
  todayCivil,
  type CivilDate,
  type HouseholdPerson,
  type SpendingNature,
} from "@fintrack/core";
import {
  authorizeAccountView,
  authorizeConnectionOwner,
  accountBalances,
  cardAccountsOf,
  cardForecast,
  cardStatements,
  connectionItemIds,
  getConnection,
  importWalletOptions,
  linkableAccounts,
  listHouseholdMembers,
  listCategories,
  prisma,
  receivedSummary,
  statementPaymentLines,
  statementPurchases,
  suggestLinks,
  type BankAccountForLink,
  type CardStatementSummary,
  type ConnectionGrant,
  type ForecastItem,
} from "@fintrack/db";
import { isProviderError } from "@fintrack/importers";
import { AccessError, requireHouseholdAccess, requireScope } from "@/lib/access";
import type { Session } from "@/lib/auth";
import { logger } from "@/lib/logger";
import { DAILY_CRON } from "./jobs";
import { keyringReady } from "./keyring";
import { pluggyFor } from "./provider";
import { payersOf } from "@/features/transactions/server/queries";

/** A conexão de quem está logado (ou null, sem lar ou sem carteira pessoal). */
export async function myConnectionGrant(session: Session): Promise<ConnectionGrant | null> {
  const access = await authorizeConnectionOwner(prisma, session.user.id);
  return access.ok ? access.grant : null;
}

/** A próxima busca agendada (04:30 em São Paulo), para a tela dizer "Amanhã, 04:30". */
export function nextScheduledRun(now: Date = new Date()): { day: CivilDate; time: string } {
  const [minute, hour] = DAILY_CRON.split(" ").map((n) => Number.parseInt(n, 10)) as [
    number,
    number,
  ];
  const time = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  const today = todayCivil(now);
  const clock = new Intl.DateTimeFormat("en-GB", {
    timeZone: "America/Sao_Paulo",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(now);
  return { day: clock < time ? today : addDays(today, 1), time };
}

// ── Ajustes > Conexões bancárias ────────────────────────────────────────────────

export async function getConnectionsPage(session: Session) {
  const grant = await myConnectionGrant(session);
  if (!grant) return { grant: null, ready: keyringReady(), connection: null } as const;
  return { grant, ready: keyringReady(), connection: await getConnection(prisma, grant) } as const;
}

/** O que o passo 1 (credenciais) precisa: os Item IDs já gravados e se já há um segredo. */
export async function getCredentialsForm(session: Session) {
  const grant = await myConnectionGrant(session);
  if (!grant) return null;
  const connection = await getConnection(prisma, grant);
  return {
    clientIdMasked: connection?.clientIdMasked ?? null,
    hasSecret: connection?.hasSecret ?? false,
    itemIds: await connectionItemIds(prisma, grant),
    ready: keyringReady(),
  };
}

// ── Passo 2: ligar as contas ────────────────────────────────────────────────────

export type LinkPage =
  | { kind: "no-connection" }
  | { kind: "error"; code: string }
  | {
      kind: "ok";
      bank: (BankAccountForLink & { suggestion: { accountId: string; reason: string } | null })[];
      accounts: Awaited<ReturnType<typeof linkableAccounts>>;
      wallets: Awaited<ReturnType<typeof importWalletOptions>>;
      importFrom: CivilDate;
      today: CivilDate;
      userId: string;
    };

/** Data de corte padrão: o 1º dia do mês passado (assim a última fatura fechada confere). */
export function defaultImportFrom(today: CivilDate): CivilDate {
  return firstDayOf(addMonthsToKey(monthOf(today), -1));
}

/**
 * As contas que o banco devolve AGORA (busca na hora, com tempo limite), com a sugestão de
 * qual conta do FinTrack é cada uma. A ligação não confia na tela: a action busca de novo.
 */
export async function bankAccountsNow(grant: ConnectionGrant): Promise<BankAccountForLink[]> {
  if (!grant.connectionId) return [];
  const provider = await pluggyFor(grant.connectionId);
  if (!provider) return [];
  const items = await connectionItemIds(prisma, grant);
  const result: BankAccountForLink[] = [];
  for (const itemId of items) {
    const item = await provider.getItem(itemId);
    for (const account of await provider.listAccounts(itemId)) {
      result.push({
        externalId: account.externalId,
        kind: account.kind,
        name: account.name,
        number: account.number,
        institution: item.institution,
        credit: account.credit
          ? {
              closeDate: account.credit.closeDate,
              dueDate: account.credit.dueDate,
              brand: account.credit.brand,
            }
          : null,
      });
    }
  }
  return result;
}

export async function getLinkPage(session: Session): Promise<LinkPage> {
  const grant = await myConnectionGrant(session);
  if (!grant?.connectionId) return { kind: "no-connection" };
  const today = todayCivil();
  let bank: BankAccountForLink[];
  try {
    bank = await bankAccountsNow(grant);
  } catch (error) {
    if (isProviderError(error)) {
      const code = error.code;
      logger.warn(
        { event: "bank.link_failed", code, userId: session.user.id },
        "banco não respondeu",
      );
      return { kind: "error", code };
    }
    throw error;
  }
  const [accounts, wallets, connection] = await Promise.all([
    linkableAccounts(prisma, grant),
    importWalletOptions(prisma, grant),
    getConnection(prisma, grant),
  ]);
  const suggestions = suggestLinks(bank, accounts);
  return {
    kind: "ok",
    bank: bank.map((b) => ({ ...b, suggestion: suggestions.get(b.externalId) ?? null })),
    accounts,
    wallets,
    importFrom: connection?.importFrom ?? defaultImportFrom(today),
    today,
    userId: session.user.id,
  };
}

// ── Sincronizações ──────────────────────────────────────────────────────────────

export async function getSyncHistory(session: Session) {
  const grant = await myConnectionGrant(session);
  if (!grant?.connectionId) return null;
  const [runs, connection, scope] = await Promise.all([
    prisma.syncRun.findMany({
      where: { connectionId: grant.connectionId },
      orderBy: { startedAt: "desc" },
      take: 30,
      select: {
        id: true,
        startedAt: true,
        finishedAt: true,
        status: true,
        trigger: true,
        itemsCreated: true,
        itemsUpdated: true,
        itemsUnchanged: true,
        itemsSkipped: true,
        error: true,
      },
    }),
    getConnection(prisma, grant),
    requireScope(session, "view"),
  ]);
  const bankUpdatedAt =
    (connection?.items ?? [])
      .map((i) => i.bankUpdatedAt)
      .filter((d): d is Date => d !== null)
      .sort((a, b) => b.getTime() - a.getTime())[0] ?? null;
  return {
    runs,
    connection,
    bankUpdatedAt,
    next: nextScheduledRun(),
    received: await receivedSummary(prisma, scope.walletIds),
  };
}

// ── Início: o dinheiro de verdade ──────────────────────────────────────────────

/**
 * O dinheiro de verdade no recorte do Início (M13.3a, prancha N-Inicio): "Na conta hoje" (as
 * correntes, com o saldo e o que sobra depois das faturas do mês), "Guardado" (as poupanças, com o
 * que mudou no mês) e "Faturas a pagar" (a fatura de cada cartão que vence agora). São os números
 * do banco, com os recebidos ainda não conferidos (ADR-025). Mais o aviso de recebidos e a linha
 * "Banco atualizado às … · buscado às …".
 */
export async function getBankHome(session: Session, walletId: string | null) {
  const scope = await requireScope(session, "view", walletId);
  const today = todayCivil();
  const month = monthOf(today);
  const [balances, cardAccounts, received, grant, people] = await Promise.all([
    accountBalances(prisma, scope, { today, periodStart: firstDayOf(month) }),
    cardAccountsOf(prisma, scope.walletIds),
    receivedSummary(prisma, scope.walletIds),
    myConnectionGrant(session),
    peopleOf(session),
  ]);
  if (balances.length === 0 && cardAccounts.length === 0 && received.count === 0) return null;
  const connectionIds = await prisma.financialAccount.findMany({
    where: {
      id: { in: [...balances.map((a) => a.id), ...cardAccounts.map((c) => c.id)] },
      connectionId: { not: null },
    },
    select: { connectionId: true },
  });
  const ids = [...new Set(connectionIds.map((a) => a.connectionId as string))];
  const [items, connections, statements] = await Promise.all([
    prisma.providerItem.findMany({
      where: { connectionId: { in: ids } },
      select: { bankUpdatedAt: true },
    }),
    prisma.providerConnection.findMany({
      where: { id: { in: ids } },
      select: { lastSyncedAt: true },
    }),
    Promise.all(
      cardAccounts.map(async (card) => ({
        card,
        statements: await cardStatements(prisma, card, today),
      })),
    ),
  ]);
  const latest = (dates: (Date | null)[]) =>
    dates.filter((d): d is Date => d !== null).sort((a, b) => b.getTime() - a.getTime())[0] ?? null;
  const byId = new Map(people.map((p) => [p.userId, p]));
  const cards = statements.map(({ card, statements: list }) => {
    const bill = defaultStatement(list, today);
    return {
      id: card.id,
      name: card.name,
      lastFour: card.lastFour,
      holders: card.holderIds.flatMap((id) => {
        const person = byId.get(id);
        return person ? [person] : [];
      }),
      bill: bill
        ? {
            id: bill.id,
            dueDate: bill.dueDate,
            closingDate: bill.closingDate,
            state: bill.state,
            amount: bill.closed?.total ?? bill.purchases,
          }
        : null,
      creditLimit: card.creditLimit,
      availableCredit: card.availableCredit,
    };
  });
  const checking = balances.filter((a) => a.kind !== "SAVINGS");
  const savings = balances.filter((a) => a.kind === "SAVINGS");
  // As faturas que vencem neste mês e ainda não foram pagas: saem da conta até o fim do mês
  const dueThisMonth = cards.flatMap((c) =>
    c.bill && monthOf(c.bill.dueDate) === month && c.bill.state !== "paid" ? [c.bill.amount] : [],
  );
  const inAccounts = checking.reduce((sum, a) => sum + a.balance.today, 0n);
  const toPay = dueThisMonth.reduce((sum, v) => sum + v, 0n);
  return {
    month,
    checking,
    savings,
    inAccounts,
    afterBills: inAccounts - toPay,
    toPay,
    saved: savings.reduce((sum, a) => sum + a.balance.today, 0n),
    savedChange: savings.reduce((sum, a) => sum + a.balance.change, 0n),
    cards,
    received,
    bankUpdatedAt: latest(items.map((i) => i.bankUpdatedAt)),
    lastSyncedAt: latest(connections.map((c) => c.lastSyncedAt)),
    /** "Buscar agora" só para quem tem a própria conexão pronta */
    canSync: Boolean(grant?.connectionId),
    today,
  };
}

export type BankHome = NonNullable<Awaited<ReturnType<typeof getBankHome>>>;

/** As pessoas do lar com as iniciais e a cor de sempre (as do "Pago por"). Sem lar, nenhuma. */
async function peopleOf(session: Session): Promise<HouseholdPerson[]> {
  try {
    const grant = await requireHouseholdAccess(session, "view");
    return householdPeople(await listHouseholdMembers(prisma, grant));
  } catch (error) {
    if (error instanceof AccessError) return [];
    throw error;
  }
}

// ── Página do cartão ────────────────────────────────────────────────────────────

/** As categorias de despesa e receita para a escolha em um clique (as mais usadas primeiro). */
export async function categoryChoices(session: Session) {
  try {
    const grant = await requireHouseholdAccess(session, "view");
    const all = await listCategories(prisma, grant);
    const byUse = all.toSorted(
      (a, b) => b.transactionCount - a.transactionCount || a.name.localeCompare(b.name),
    );
    const pick = (kind: "EXPENSE" | "INCOME") =>
      byUse
        .filter((c) => c.kind === kind)
        .map((c) => ({ id: c.id, name: c.name, parent: c.parentName }));
    return { expense: pick("EXPENSE"), income: pick("INCOME") };
  } catch (error) {
    if (error instanceof AccessError) return { expense: [], income: [] };
    throw error;
  }
}

/** A natureza da compra pela aba da fatura (`?tipo=`). */
export const NATURE_PARAM: Record<string, SpendingNature> = {
  fixas: "fixed",
  parcelas: "installment",
  variaveis: "variable",
};

/** Uma fatura na página de Cartões: a gravada ou a que ainda não existe, com as previstas dela. */
export type StatementView = CardStatementSummary & {
  /** A fatura ainda não existe: só as previstas (fixas e parcelas) dela */
  virtual: boolean;
  forecast: ForecastItem[];
  /** As previstas somadas (positivo = a pagar), no total e por tipo */
  forecastTotal: bigint;
  forecastByNature: { fixed: bigint; installment: bigint };
};

/** O id da fatura que ainda não existe, na URL (`?fatura=prevista-2026-12`). */
const virtualId = (dueDate: CivilDate) => `prevista-${monthOf(dueDate)}`;

/**
 * As faturas gravadas e as que ainda não existem e já têm previstas (M13.3c, ADR-027; pranchas
 * O-FaturaFutura e N-Projecao), cada uma com as previstas que vencem no mês dela.
 */
function withForecast(
  real: readonly CardStatementSummary[],
  forecast: Awaited<ReturnType<typeof cardForecast>>,
  today: CivilDate,
): StatementView[] {
  const cycle = forecast.cycle;
  const virtual: CardStatementSummary[] = cycle
    ? futureStatements(
        real,
        forecast.items.map((i) => i.cashDate),
        cycle,
      ).map((s) => {
        const previous = statementOfMonth(addMonthsToKey(s.referenceMonth, -1), cycle);
        const window = statementWindow({
          closingDate: s.closingDate,
          previousClosingDate: previous.closingDate,
        });
        return {
          id: virtualId(s.dueDate),
          referenceMonth: s.referenceMonth,
          closingDate: s.closingDate,
          dueDate: s.dueDate,
          window,
          state: statementState({ window, today, paid: false }),
          purchases: 0n,
          purchaseCount: 0,
          pendingCount: 0,
          byNature: { fixed: 0n, installment: 0n, variable: 0n },
          closed: null,
          payments: [],
          paid: 0n,
        };
      })
    : [];
  const virtualIds = new Set(virtual.map((v) => v.id));
  return [...real, ...virtual]
    .toSorted((a, b) => (a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : 0))
    .map((s) => {
      const lines = forecast.items.filter((i) => monthOf(i.cashDate) === monthOf(s.dueDate));
      const sum = (source: "recurrence" | "installment") =>
        lines.filter((l) => l.source === source).reduce((t, l) => t - l.amount, 0n);
      const byNature = { fixed: sum("recurrence"), installment: sum("installment") };
      return {
        ...s,
        virtual: virtualIds.has(s.id),
        forecast: lines,
        forecastTotal: byNature.fixed + byNature.installment,
        forecastByNature: byNature,
      };
    });
}

/**
 * Cartões (M13.3a, prancha N-Cartoes): um cartão e uma fatura por vez. `?conta=` escolhe o cartão
 * (a conta da fatura) e `?fatura=` a fatura; sem eles, o primeiro cartão e a fatura que ainda vai
 * vencer. Quem vê: quem vê o ambiente da conta do cartão (o crachá da conta).
 */
export async function getCardsPage(
  session: Session,
  params: Record<string, string | string[] | undefined>,
) {
  const one = (value: string | string[] | undefined) =>
    (Array.isArray(value) ? value[0] : value)?.trim() || null;
  const scope = await requireScope(session, "view");
  const today = todayCivil();
  const [accounts, categories, people, payers] = await Promise.all([
    cardAccountsOf(prisma, scope.walletIds),
    categoryChoices(session),
    peopleOf(session),
    payersOf(session),
  ]);
  const requested = one(params.conta);
  const chosen = accounts.find((a) => a.id === requested) ?? accounts[0] ?? null;
  if (!chosen) return { accounts: [], today, chosen: null } as const;
  const access = await authorizeAccountView(prisma, session.user.id, chosen.id);
  if (!access.ok) throw new AccessError("NOT_FOUND");
  const all = await Promise.all(
    accounts.map(async (a) => ({
      account: a,
      statements: await cardStatements(prisma, a, today),
    })),
  );
  const forecast = await cardForecast(prisma, scope, chosen.id, today);
  const statements = withForecast(
    all.find((x) => x.account.id === chosen.id)?.statements ?? [],
    forecast,
    today,
  );
  const statement =
    statements.find((s) => s.id === one(params.fatura)) ?? defaultStatement(statements, today);
  const index = statement ? statements.indexOf(statement) : -1;
  const previous = index > 0 ? statements[index - 1] : null;
  const nature = NATURE_PARAM[one(params.tipo) ?? ""] ?? null;
  const [purchases, previousPaid, connection, grant] = await Promise.all([
    statement && !statement.virtual ? statementPurchases(prisma, access.grant, statement.id) : [],
    previous && !previous.virtual ? statementPaymentLines(prisma, chosen.id, previous) : [],
    chosen.connectionId
      ? prisma.providerConnection.findUnique({
          where: { id: chosen.connectionId },
          select: {
            userId: true,
            lastSyncedAt: true,
            items: { select: { bankUpdatedAt: true } },
          },
        })
      : null,
    myConnectionGrant(session),
  ]);
  const byId = new Map(people.map((p) => [p.userId, p]));
  const bankUpdatedAt =
    connection?.items
      .map((i) => i.bankUpdatedAt)
      .filter((d): d is Date => d !== null)
      .sort((a, b) => b.getTime() - a.getTime())[0] ?? null;
  return {
    today,
    accounts: all.map(({ account, statements: list }) => {
      const bill = defaultStatement(list, today);
      return {
        ...account,
        holders: account.holderIds.flatMap((id) => {
          const person = byId.get(id);
          return person ? [person] : [];
        }),
        bill: bill ? { dueDate: bill.dueDate, amount: bill.closed?.total ?? bill.purchases } : null,
      };
    }),
    chosen,
    wallet: access.grant.wallet.wallet,
    canEdit: access.grant.wallet.role !== "VIEWER",
    statements,
    statement,
    previous,
    next: index >= 0 ? (statements[index + 1] ?? null) : null,
    previousPaid,
    nature,
    purchases: nature ? purchases.filter((p) => p.nature === nature) : purchases,
    /** Quem pagou cada compra, pelo nome (o "final 0001 · Lia" da linha) */
    payers,
    categories,
    lastSyncedAt: connection?.lastSyncedAt ?? null,
    bankUpdatedAt,
    canSync: Boolean(grant?.connectionId && connection && connection.userId === session.user.id),
  };
}

/**
 * Para onde vai o endereço antigo de uma conta (`/carteiras/conta/[id]`, M09.1): o cartão para
 * Cartões, o resto para Lançamentos. Conta que a pessoa não vê: null (a página responde 404).
 */
export async function accountPageTarget(session: Session, accountId: string) {
  const access = await authorizeAccountView(prisma, session.user.id, accountId);
  if (!access.ok) return null;
  const { account } = access.grant;
  return account.kind === "CREDIT_CARD"
    ? `/cartoes?conta=${account.id}`
    : `/lancamentos?conta=${account.id}`;
}
