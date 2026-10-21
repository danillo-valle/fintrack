// Leituras das telas da coleta bancária (M09.1). Toda leitura parte de um crachá: a conexão é
// sempre a de quem está logado (ConnectionGrant), a conta do cartão passa por authorizeAccountView
// e o Início usa o escopo das carteiras que a pessoa vê.
import "server-only";
import {
  addDays,
  addMonthsToKey,
  firstDayOf,
  monthOf,
  todayCivil,
  type CivilDate,
} from "@fintrack/core";
import {
  authorizeAccountView,
  authorizeConnectionOwner,
  bankLinkedAccounts,
  cardStatementView,
  connectionItemIds,
  getConnection,
  importWalletOptions,
  linkableAccounts,
  openStatementTotals,
  listCategories,
  prisma,
  receivedSummary,
  suggestLinks,
  type BankAccountForLink,
  type ConnectionGrant,
} from "@fintrack/db";
import { isProviderError } from "@fintrack/importers";
import { AccessError, requireHouseholdAccess, requireScope } from "@/lib/access";
import type { Session } from "@/lib/auth";
import { logger } from "@/lib/logger";
import { DAILY_CRON } from "./jobs";
import { keyringReady } from "./keyring";
import { pluggyFor } from "./provider";

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

// ── Início: contas e cartões ────────────────────────────────────────────────────

/**
 * As contas ligadas ao banco no recorte do Início (as carteiras do escopo), o aviso de
 * recebidos e a linha "Banco atualizado às … · buscado às …".
 */
export async function getBankHome(session: Session, walletId: string | null) {
  const scope = await requireScope(session, "view", walletId);
  const [accounts, received, grant] = await Promise.all([
    bankLinkedAccounts(prisma, scope.walletIds),
    receivedSummary(prisma, scope.walletIds),
    myConnectionGrant(session),
  ]);
  if (accounts.length === 0 && received.count === 0) return null;
  const connectionIds = [
    ...new Set(
      (
        await prisma.financialAccount.findMany({
          where: { id: { in: accounts.map((a) => a.id) } },
          select: { connectionId: true },
        })
      )
        .map((a) => a.connectionId)
        .filter((id): id is string => id !== null),
    ),
  ];
  const [items, connections] = await Promise.all([
    prisma.providerItem.findMany({
      where: { connectionId: { in: connectionIds } },
      select: { bankUpdatedAt: true },
    }),
    prisma.providerConnection.findMany({
      where: { id: { in: connectionIds } },
      select: { lastSyncedAt: true },
    }),
  ]);
  const today = todayCivil();
  const openTotals = await openStatementTotals(
    prisma,
    accounts.map((a) => a.id),
    today,
  );
  const latest = (dates: (Date | null)[]) =>
    dates.filter((d): d is Date => d !== null).sort((a, b) => b.getTime() - a.getTime())[0] ?? null;
  return {
    accounts: accounts.map((a) => ({ ...a, openTotal: openTotals.get(a.id) ?? null })),
    received,
    bankUpdatedAt: latest(items.map((i) => i.bankUpdatedAt)),
    lastSyncedAt: latest(connections.map((c) => c.lastSyncedAt)),
    /** "Buscar agora" só para quem tem a própria conexão pronta */
    canSync: Boolean(grant?.connectionId),
    today,
  };
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

export async function getCardPage(session: Session, accountId: string) {
  const access = await authorizeAccountView(prisma, session.user.id, accountId);
  if (!access.ok) throw new AccessError("NOT_FOUND");
  const today = todayCivil();
  const [view, categories, connection, grant, card] = await Promise.all([
    cardStatementView(prisma, access.grant, today),
    categoryChoices(session),
    access.grant.account.connectionId
      ? prisma.providerConnection.findUnique({
          where: { id: access.grant.account.connectionId },
          select: {
            userId: true,
            lastSyncedAt: true,
            items: { select: { bankUpdatedAt: true, institution: true } },
          },
        })
      : null,
    myConnectionGrant(session),
    // O cartão principal da conta (o primeiro cadastrado), para o título "Mastercard final 0001"
    prisma.paymentCard.findFirst({
      where: { accountId, archivedAt: null },
      orderBy: { createdAt: "asc" },
      select: { lastFour: true },
    }),
  ]);
  const bankUpdatedAt =
    connection?.items
      .map((i) => i.bankUpdatedAt)
      .filter((d): d is Date => d !== null)
      .sort((a, b) => b.getTime() - a.getTime())[0] ?? null;
  return {
    ...view,
    wallet: access.grant.wallet.wallet,
    canEdit: access.grant.wallet.role !== "VIEWER",
    categories,
    lastFour: card?.lastFour ?? null,
    lastSyncedAt: connection?.lastSyncedAt ?? null,
    bankUpdatedAt,
    canSync: Boolean(grant?.connectionId && connection && connection.userId === session.user.id),
    today,
  };
}
