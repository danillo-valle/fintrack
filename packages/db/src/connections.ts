// A conexão de cada pessoa com o banco pelo Meu Pluggy (M09.1, ADR-011): credenciais cifradas,
// os bancos (Item IDs), a ligação conta do banco ↔ conta do FinTrack e a data de corte.
//
// Toda operação exige o ConnectionGrant (access.ts): a pessoa só mexe na PRÓPRIA conexão. Ligar
// uma conta do FinTrack exige, além disso, que a pessoa seja a titular dela ou dona da carteira
// que a gere (o Meu Pluggy só traz contas em nome de quem conectou).
//
// Nunca vai para auditoria, log ou tela: Client Secret, Client ID inteiro, Item ID e número de
// conta. A tela mostra o Client ID só com os 4 últimos caracteres.
import {
  addMonths,
  civilFromDbDate,
  compareCivil,
  dbDateFromCivil,
  defaultAccountName,
  lastFourOf,
  parseCivilDate,
  suggestAccountLink,
  type CivilDate,
  type LinkCandidate,
  type LinkSuggestion,
} from "@fintrack/core";
import { householdWalletOptions } from "./accounts";
import { DomainError, type ConnectionGrant } from "./access";
import { writeAudit, type RequestContext } from "./audit";
import { sealSecret, type SecretKeyring } from "./connection-secret";
import type { Prisma, PrismaClient } from "./generated/prisma/client";
import { fromDbDecimalOrNull } from "./money";

/** O Meu Pluggy aceita até 5 conexões ativas por conta: o FinTrack segue o mesmo limite. */
export const MAX_PROVIDER_ITEMS = 5;
const ITEM_ID_RE = /^[A-Za-z0-9-]{8,64}$/;

/** Client ID para mostrar: só o final ("…c1d0"). */
export function maskClientId(clientId: string | null): string | null {
  return clientId ? `…${clientId.slice(-4)}` : null;
}

// ── Ler ─────────────────────────────────────────────────────────────────────────

/** Tudo que a tela de Conexões bancárias mostra (sem segredo nenhum). */
export async function getConnection(db: PrismaClient, grant: ConnectionGrant) {
  if (!grant.connectionId) return null;
  const connection = await db.providerConnection.findUnique({
    where: { id: grant.connectionId },
    select: {
      id: true,
      status: true,
      clientId: true,
      secretCiphertext: true,
      importFrom: true,
      lastSyncedAt: true,
      items: {
        orderBy: { createdAt: "asc" },
        select: { id: true, externalId: true, institution: true, bankUpdatedAt: true },
      },
      accounts: {
        where: { archivedAt: null },
        orderBy: { name: "asc" },
        select: { id: true, name: true, kind: true, institution: true, externalId: true },
      },
      runs: {
        orderBy: { startedAt: "desc" },
        take: 1,
        select: { status: true, startedAt: true, finishedAt: true, error: true },
      },
    },
  });
  if (!connection) return null;
  return {
    id: connection.id,
    status: connection.status,
    clientIdMasked: maskClientId(connection.clientId),
    hasSecret: !!connection.secretCiphertext,
    importFrom: connection.importFrom ? civilFromDbDate(connection.importFrom) : null,
    lastSyncedAt: connection.lastSyncedAt,
    items: connection.items.map((item, index) => ({
      id: item.id,
      position: index + 1,
      institution: item.institution,
      bankUpdatedAt: item.bankUpdatedAt,
    })),
    accounts: connection.accounts.map((a) => ({
      id: a.id,
      name: a.name,
      kind: a.kind,
      institution: a.institution,
    })),
    lastRun: connection.runs[0] ?? null,
  };
}

/**
 * O que a sincronização precisa para falar com o banco: credenciais (ainda cifradas) e os Item
 * IDs. Só o servidor chama; nada disto sai para a tela.
 */
export async function connectionForProvider(db: PrismaClient, connectionId: string) {
  return db.providerConnection.findUnique({
    where: { id: connectionId },
    select: {
      id: true,
      userId: true,
      clientId: true,
      secretCiphertext: true,
      importFrom: true,
      lastSyncedAt: true,
      items: { select: { id: true, externalId: true } },
    },
  });
}

/** Os Item IDs da própria conexão, para a tela de credenciais ("Banco 1", "Banco 2"...). */
export async function connectionItemIds(db: PrismaClient, grant: ConnectionGrant) {
  if (!grant.connectionId) return [];
  const items = await db.providerItem.findMany({
    where: { connectionId: grant.connectionId },
    orderBy: { createdAt: "asc" },
    select: { externalId: true },
  });
  return items.map((i) => i.externalId);
}

// ── Credenciais ─────────────────────────────────────────────────────────────────

export type CredentialsInput = {
  clientId: string;
  /** Vazio = manter o atual (só vale se já houver um gravado) */
  clientSecret: string | null;
  itemIds: string[];
};

/** Confere o formato dos Item IDs: de 1 a 5, sem repetir, letras, números e hífen. */
export function normalizeItemIds(itemIds: readonly string[]): string[] {
  const ids = [...new Set(itemIds.map((id) => id.trim()).filter(Boolean))];
  if (ids.length === 0 || ids.length > MAX_PROVIDER_ITEMS)
    throw new DomainError("CONNECTION_ITEMS_LIMIT");
  if (!ids.every((id) => ITEM_ID_RE.test(id))) throw new DomainError("CONNECTION_ITEM_INVALID");
  return ids;
}

/**
 * Grava (ou troca) Client ID, Client Secret e os bancos da conexão da pessoa. O segredo é
 * cifrado aqui, com o id da conexão como dado associado. Quem chama já testou as credenciais
 * contra a Pluggy (a tela "Testar e continuar").
 */
export async function saveCredentials(
  db: PrismaClient,
  grant: ConnectionGrant,
  input: CredentialsInput,
  keyring: SecretKeyring,
  ctx: RequestContext,
): Promise<{ connectionId: string }> {
  const itemIds = normalizeItemIds(input.itemIds);
  const clientId = input.clientId.trim();
  if (clientId.length < 8 || clientId.length > 100)
    throw new DomainError("CONNECTION_ITEM_INVALID");
  return db.$transaction(async (tx) => {
    const existing = grant.connectionId
      ? await tx.providerConnection.findUnique({
          where: { id: grant.connectionId },
          select: { id: true, secretCiphertext: true },
        })
      : null;
    if (!existing && !input.clientSecret) throw new DomainError("CONNECTION_SECRET_REQUIRED");
    if (existing && !existing.secretCiphertext && !input.clientSecret) {
      throw new DomainError("CONNECTION_SECRET_REQUIRED");
    }
    const connection =
      existing ??
      (await tx.providerConnection.create({
        data: {
          userId: grant.userId,
          walletId: grant.personalWalletId,
          provider: "PLUGGY",
          clientId,
        },
        select: { id: true, secretCiphertext: true },
      }));
    await tx.providerConnection.update({
      where: { id: connection.id },
      data: {
        clientId,
        status: "ACTIVE",
        ...(input.clientSecret
          ? { secretCiphertext: sealSecret(keyring, connection.id, input.clientSecret) }
          : {}),
      },
    });
    // Os bancos: os novos entram, os que saíram da lista saem (as contas ligadas continuam no
    // FinTrack, só param de sincronizar)
    await tx.providerItem.deleteMany({
      where: { connectionId: connection.id, externalId: { notIn: itemIds } },
    });
    for (const externalId of itemIds) {
      await tx.providerItem.upsert({
        where: { connectionId_externalId: { connectionId: connection.id, externalId } },
        create: { connectionId: connection.id, externalId },
        update: {},
      });
    }
    await writeAudit(
      tx,
      {
        actorId: grant.userId,
        householdId: grant.householdId,
        action: "connection.saved",
        entity: "provider_connection",
        entityId: connection.id,
        metadata: {
          provider: "PLUGGY",
          banks: itemIds.length,
          secretChanged: !!input.clientSecret,
          created: !existing,
        },
      },
      ctx,
    );
    return { connectionId: connection.id };
  });
}

// ── Ligar as contas ─────────────────────────────────────────────────────────────

/** Uma conta como o banco devolveu agora (o servidor busca de novo; a tela não decide isto). */
export type BankAccountForLink = {
  externalId: string;
  kind: "CHECKING" | "SAVINGS" | "CREDIT_CARD";
  name: string;
  number: string | null;
  institution: string | null;
  credit: { closeDate: CivilDate | null; dueDate: CivilDate | null; brand: string | null } | null;
};

/** Onde entram as compras de cada cartão (nulo = a regra padrão de importWalletFor). */
export type CardWalletChoice = { cardId: string; walletId: string | null };

export type LinkChoice =
  | { externalId: string; target: "existing"; accountId: string }
  | { externalId: string; target: "new" }
  | { externalId: string; target: "skip" };

/**
 * As contas do FinTrack que a pessoa pode ligar: as de que ela é titular e as das carteiras de
 * que é dona (manage_accounts), ativas. Cada uma com a sugestão da conta do banco (pelo final do
 * cartão ou pelo nome) para a tela já vir preenchida.
 */
export async function linkableAccounts(db: PrismaClient, grant: ConnectionGrant) {
  const owned = await db.walletMember.findMany({
    where: { userId: grant.userId, role: "OWNER", wallet: { householdId: grant.householdId } },
    select: { walletId: true },
  });
  const rows = await db.financialAccount.findMany({
    where: {
      householdId: grant.householdId,
      archivedAt: null,
      OR: [{ holderId: grant.userId }, { walletId: { in: owned.map((w) => w.walletId) } }],
    },
    orderBy: [{ name: "asc" }],
    select: {
      id: true,
      name: true,
      kind: true,
      institution: true,
      connectionId: true,
      externalId: true,
      wallet: { select: { name: true, kind: true } },
      holderId: true,
      walletId: true,
      cards: {
        where: { archivedAt: null },
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          lastFour: true,
          holderId: true,
          importWalletId: true,
          holder: { select: { name: true } },
        },
      },
    },
  });
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    kind: row.kind,
    institution: row.institution,
    walletName: row.wallet.name,
    walletKind: row.wallet.kind,
    lastFours: row.cards.map((c) => c.lastFour),
    holderId: row.holderId,
    walletId: row.walletId,
    /** Os cartões da conta: quem usa e onde entram as compras importadas (M09.1) */
    cards: row.cards.map((c) => ({
      id: c.id,
      lastFour: c.lastFour,
      holderId: c.holderId,
      holderName: c.holder?.name ?? null,
      importWalletId: c.importWalletId,
      /** Adicional de outra pessoa: por padrão, as compras entram no ambiente pessoal dela */
      otherHolder: c.holderId !== null && c.holderId !== row.holderId,
    })),
    /** Já ligada a esta conexão: o id da conta no banco (para pré-selecionar) */
    linkedExternalId: row.connectionId === grant.connectionId ? row.externalId : null,
    linkedElsewhere: row.connectionId !== null && row.connectionId !== grant.connectionId,
  }));
}

export type LinkableAccount = Awaited<ReturnType<typeof linkableAccounts>>[number];

/** A sugestão de cada conta do banco, sem repetir a mesma conta do FinTrack para duas. */
export function suggestLinks(
  bank: readonly BankAccountForLink[],
  accounts: readonly LinkableAccount[],
): Map<string, LinkSuggestion | { accountId: string; reason: "LINKED" }> {
  const result = new Map<string, LinkSuggestion | { accountId: string; reason: "LINKED" }>();
  const taken = new Set<string>();
  for (const b of bank) {
    const linked = accounts.find((a) => a.linkedExternalId === b.externalId);
    if (linked) {
      result.set(b.externalId, { accountId: linked.id, reason: "LINKED" });
      taken.add(linked.id);
    }
  }
  for (const b of bank) {
    if (result.has(b.externalId)) continue;
    const candidates: LinkCandidate[] = accounts.map((a) => ({
      id: a.id,
      kind: a.kind,
      name: a.name,
      institution: a.institution,
      lastFours: a.lastFours,
      linked: taken.has(a.id) || a.linkedElsewhere || a.linkedExternalId !== null,
    }));
    const suggestion = suggestAccountLink(b, candidates);
    if (suggestion) {
      result.set(b.externalId, suggestion);
      taken.add(suggestion.accountId);
    }
  }
  return result;
}

const SAME_KIND: Record<BankAccountForLink["kind"], readonly string[]> = {
  CHECKING: ["CHECKING", "SAVINGS"],
  SAVINGS: ["SAVINGS", "CHECKING"],
  CREDIT_CARD: ["CREDIT_CARD"],
};

/** A data de corte vale entre 12 meses atrás (o que o banco guarda de cartão) e hoje. */
export function assertImportFrom(importFrom: CivilDate, today: CivilDate) {
  parseCivilDate(importFrom);
  if (compareCivil(importFrom, today) > 0 || compareCivil(importFrom, addMonths(today, -12)) < 0) {
    throw new DomainError("IMPORT_FROM_INVALID");
  }
}

/** Dia do mês de uma data civil (para o ciclo de uma conta de cartão criada a partir do banco). */
const dayOf = (date: CivilDate | null) => (date ? parseCivilDate(date).day : null);

/** Nome de bandeira para exibir: "MASTERCARD" → "Mastercard". */
const brandName = (brand: string | null) =>
  brand ? brand.charAt(0).toUpperCase() + brand.slice(1).toLowerCase() : "Cartão";

/**
 * Grava a escolha de cada conta do banco: ligar a uma conta existente, criar uma conta nova na
 * carteira pessoal (com o cartão de mesmo final) ou não importar. Grava também a data de corte.
 * Tudo numa transação, com uma linha de auditoria (só contagens).
 */
export async function linkAccounts(
  db: PrismaClient,
  grant: ConnectionGrant,
  input: {
    bank: readonly BankAccountForLink[];
    choices: readonly LinkChoice[];
    /** Onde entram as compras de cada cartão das contas ligadas agora (padrão: nulo) */
    cardWallets?: readonly CardWalletChoice[];
    importFrom: CivilDate;
    today: CivilDate;
  },
  ctx: RequestContext,
) {
  if (!grant.connectionId) throw new DomainError("CONNECTION_NOT_READY");
  const connectionId = grant.connectionId;
  assertImportFrom(input.importFrom, input.today);
  const bankById = new Map(input.bank.map((b) => [b.externalId, b]));
  const allowed = new Map((await linkableAccounts(db, grant)).map((a) => [a.id, a]));
  const counts = { linked: 0, created: 0, skipped: 0 };
  const linkedNow = new Map<string, LinkableAccount>();

  await db.$transaction(async (tx) => {
    for (const choice of input.choices) {
      const bank = bankById.get(choice.externalId);
      if (!bank) throw new DomainError("PROVIDER_ACCOUNT_UNKNOWN");
      // Qualquer conta que hoje aponta para esta conta do banco é desligada primeiro
      await tx.financialAccount.updateMany({
        where: { connectionId, externalId: bank.externalId },
        data: { connectionId: null, externalId: null },
      });
      if (choice.target === "skip") {
        counts.skipped += 1;
        continue;
      }
      if (choice.target === "existing") {
        const account = allowed.get(choice.accountId);
        if (!account) throw new DomainError("NOT_FOUND");
        if (!SAME_KIND[bank.kind].includes(account.kind))
          throw new DomainError("ACCOUNT_KIND_MISMATCH");
        if (account.linkedElsewhere) throw new DomainError("ACCOUNT_ALREADY_LINKED");
        const { count } = await tx.financialAccount.updateMany({
          where: { id: account.id, householdId: grant.householdId, archivedAt: null },
          data: {
            connectionId,
            externalId: bank.externalId,
            institution: account.institution ?? bank.institution,
          },
        });
        if (count === 0) throw new DomainError("NOT_FOUND");
        linkedNow.set(account.id, account);
        counts.linked += 1;
        continue;
      }
      // Conta nova na carteira pessoal de quem conectou (o titular é a própria pessoa)
      const isCard = bank.kind === "CREDIT_CARD";
      const closingDay = isCard ? dayOf(bank.credit?.closeDate ?? null) : null;
      const dueDay = isCard ? dayOf(bank.credit?.dueDate ?? null) : null;
      if (isCard && (closingDay === null || dueDay === null || closingDay === dueDay)) {
        // O final vai junto (M13.2): a mensagem diz qual cartão não veio com as datas
        throw new DomainError("CARD_CYCLE_MISSING", { lastFour: lastFourOf(bank.number) });
      }
      const account = await tx.financialAccount.create({
        data: {
          householdId: grant.householdId,
          walletId: grant.personalWalletId,
          holderId: grant.userId,
          // "Itaú · Conta corrente" (M13.2): o banco costuma dar o mesmo nome à corrente e à poupança
          name: defaultAccountName({
            institution: bank.institution,
            bankName: bank.name,
            kind: bank.kind,
          }),
          kind: bank.kind,
          institution: bank.institution,
          closingDay,
          dueDay,
          connectionId,
          externalId: bank.externalId,
        },
        select: { id: true },
      });
      await writeAudit(
        tx,
        {
          actorId: grant.userId,
          householdId: grant.householdId,
          action: "account.created",
          entity: "financial_account",
          entityId: account.id,
          metadata: { kind: bank.kind, walletId: grant.personalWalletId, from: "bank" },
        },
        ctx,
      );
      const lastFour = isCard ? lastFourOf(bank.number) : null;
      if (lastFour) {
        const card = await tx.paymentCard.create({
          data: {
            accountId: account.id,
            holderId: grant.userId,
            nickname: `${brandName(bank.credit?.brand ?? null)} ${lastFour}`,
            brand: brandName(bank.credit?.brand ?? null),
            lastFour,
            form: "PHYSICAL",
          },
          select: { id: true },
        });
        await writeAudit(
          tx,
          {
            actorId: grant.userId,
            householdId: grant.householdId,
            action: "card.created",
            entity: "payment_card",
            entityId: card.id,
            metadata: { accountId: account.id, from: "bank" },
          },
          ctx,
        );
      }
      counts.created += 1;
    }
    // O ambiente das compras de cada cartão: só cartões das contas ligadas neste envio
    for (const choiceCard of input.cardWallets ?? []) {
      const owner = [...linkedNow.values()].find((a) =>
        a.cards.some((c) => c.id === choiceCard.cardId),
      );
      if (!owner) throw new DomainError("NOT_FOUND");
      await setCardImportWalletTx(tx, grant, owner, choiceCard);
    }
    await tx.providerConnection.update({
      where: { id: connectionId },
      data: { importFrom: dbDateFromCivil(input.importFrom) },
    });
    await writeAudit(
      tx,
      {
        actorId: grant.userId,
        householdId: grant.householdId,
        action: "connection.accounts_linked",
        entity: "provider_connection",
        entityId: connectionId,
        metadata: { ...counts, importFrom: input.importFrom },
      },
      ctx,
    );
  });
  return counts;
}

/**
 * Os ambientes em que as compras de um cartão podem entrar: os do lar, ativos, de que o
 * PORTADOR do cartão participa (senão ele não veria as próprias compras). Para a tela.
 */
export async function importWalletOptions(db: PrismaClient, grant: ConnectionGrant) {
  return householdWalletOptions(db, grant.householdId);
}

/** Grava o ambiente das compras importadas de um cartão da conta (dentro da transação). */
async function setCardImportWalletTx(
  tx: Prisma.TransactionClient,
  grant: ConnectionGrant,
  account: LinkableAccount,
  choice: CardWalletChoice,
) {
  const card = account.cards.find((c) => c.id === choice.cardId);
  if (!card) throw new DomainError("NOT_FOUND");
  if (choice.walletId) {
    const wallet = await tx.wallet.findFirst({
      where: { id: choice.walletId, householdId: grant.householdId, archivedAt: null },
      select: { members: { select: { userId: true } } },
    });
    const members = wallet?.members.map((m) => m.userId) ?? [];
    if (!wallet || (card.holderId !== null && !members.includes(card.holderId))) {
      throw new DomainError("NOT_FOUND");
    }
  }
  await tx.paymentCard.updateMany({
    where: { id: card.id, accountId: account.id },
    data: { importWalletId: choice.walletId },
  });
}

/** Registra que a pessoa pediu uma busca (o botão "Buscar agora"). */
export async function recordSyncRequest(
  db: PrismaClient,
  grant: ConnectionGrant,
  ctx: RequestContext,
) {
  if (!grant.connectionId) throw new DomainError("CONNECTION_NOT_READY");
  const connectionId = grant.connectionId;
  await db.$transaction(async (tx) => {
    await writeAudit(
      tx,
      {
        actorId: grant.userId,
        householdId: grant.householdId,
        action: "connection.sync_requested",
        entity: "provider_connection",
        entityId: connectionId,
      },
      ctx,
    );
  });
}

// ── Contas e cartões no Início ──────────────────────────────────────────────────

/**
 * As contas ligadas ao banco que a pessoa VÊ (pelas carteiras do escopo), com o último saldo e
 * limite informados. É o bloco "Contas e cartões" do Início.
 */
export async function bankLinkedAccounts(db: PrismaClient, walletIds: readonly string[]) {
  const rows = await db.financialAccount.findMany({
    where: { walletId: { in: [...walletIds] }, connectionId: { not: null }, archivedAt: null },
    orderBy: [{ kind: "asc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      kind: true,
      institution: true,
      closingDay: true,
      dueDay: true,
      wallet: { select: { id: true, name: true, kind: true } },
      holderId: true,
      cards: {
        where: { archivedAt: null },
        select: { lastFour: true, holderId: true, isAdditional: true },
        orderBy: { createdAt: "asc" },
      },
      bankBalance: true,
    },
  });
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    kind: row.kind,
    institution: row.institution,
    cycle:
      row.closingDay !== null && row.dueDay !== null
        ? { closingDay: row.closingDay, dueDay: row.dueDay }
        : null,
    wallet: row.wallet,
    lastFour: row.cards[0]?.lastFour ?? null,
    /** Quem usa os cartões da conta (M13.2: as iniciais em "Seus cartões"), o titular primeiro */
    holderIds: [
      ...new Set(
        [row.holderId, ...row.cards.map((c) => c.holderId)].filter(
          (id): id is string => id !== null,
        ),
      ),
    ],
    additionalCount: row.cards.filter((c) => c.isAdditional).length,
    balance: row.bankBalance
      ? {
          balance: fromDbDecimalOrNull(row.bankBalance.balance),
          creditLimit: fromDbDecimalOrNull(row.bankBalance.creditLimit),
          availableCredit: fromDbDecimalOrNull(row.bankBalance.availableCredit),
          closeDate: row.bankBalance.closeDate ? civilFromDbDate(row.bankBalance.closeDate) : null,
          dueDate: row.bankBalance.dueDate ? civilFromDbDate(row.bankBalance.dueDate) : null,
          asOf: row.bankBalance.asOf,
        }
      : null,
  }));
}
