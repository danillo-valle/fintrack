// Contas e cartões (M07): de onde o dinheiro sai e para onde entra.
//
// Uma conta é gerida numa carteira (walletId): criar e arquivar conta ou cartão pede o crachá
// "manage_accounts" daquela carteira (só o dono). LANÇAR numa conta é outra pergunta,
// respondida por authorizeAccountUse (access.ts): quem edita a carteira da conta, ou quem é
// portador de um cartão dela (o adicional do cônjuge).
//
// Cartão: só os 4 últimos dígitos (CHECK no banco). Nunca o número inteiro, validade ou CVV.
import type { AccountKind } from "@fintrack/core";
import { DomainError, type WalletGrant } from "./access";
import { writeAudit, type RequestContext } from "./audit";
import type { PrismaClient } from "./generated/prisma/client";
import { fromDbDecimal, toDbDecimal } from "./money";

/** Contas em que a pessoa pode lançar: as das carteiras que ela edita e as dos cartões dela. */
export async function listUsableAccounts(db: PrismaClient, userId: string) {
  const editable = await db.walletMember.findMany({
    where: { userId, role: { in: ["OWNER", "EDITOR"] }, wallet: { archivedAt: null } },
    select: { walletId: true },
  });
  const rows = await db.financialAccount.findMany({
    where: {
      archivedAt: null,
      OR: [
        { walletId: { in: editable.map((w) => w.walletId) } },
        { cards: { some: { holderId: userId, archivedAt: null } } },
      ],
    },
    orderBy: [{ name: "asc" }],
    select: {
      id: true,
      name: true,
      kind: true,
      walletId: true,
      holderId: true,
      closingDay: true,
      dueDay: true,
      wallet: { select: { name: true } },
      cards: {
        where: { archivedAt: null },
        orderBy: { nickname: "asc" },
        select: { id: true, nickname: true, lastFour: true, holderId: true, sharedPurchases: true },
      },
    },
  });
  const canEdit = new Set(editable.map((w) => w.walletId));
  return rows.map((a) => ({
    id: a.id,
    name: a.name,
    kind: a.kind as AccountKind,
    walletId: a.walletId,
    walletName: a.wallet.name,
    /** Titular: quem aparece em "Pago por" quando não há cartão (M07.4) */
    holderId: a.holderId,
    /** Ciclo do cartão de crédito, para o plano de parcelas (nulo nas outras contas) */
    cycle:
      a.closingDay !== null && a.dueDay !== null
        ? { closingDay: a.closingDay, dueDay: a.dueDay }
        : null,
    /** WALLET: a pessoa edita a carteira da conta; CARD: só usa o próprio cartão adicional */
    via: canEdit.has(a.walletId) ? ("WALLET" as const) : ("CARD" as const),
    // Pela porta do cartão, a pessoa só vê (e usa) os próprios cartões
    cards: canEdit.has(a.walletId) ? a.cards : a.cards.filter((c) => c.holderId === userId),
  }));
}

/** As contas geridas numa carteira, com os cartões, para a tela de contas. */
export async function listWalletAccounts(db: PrismaClient, grant: WalletGrant<"view">) {
  const rows = await db.financialAccount.findMany({
    where: { walletId: grant.wallet.id },
    orderBy: [{ archivedAt: { sort: "asc", nulls: "first" } }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      kind: true,
      institution: true,
      closingDay: true,
      dueDay: true,
      initialBalance: true,
      archivedAt: true,
      holder: { select: { name: true } },
      cards: {
        orderBy: [{ archivedAt: { sort: "asc", nulls: "first" } }, { nickname: "asc" }],
        select: {
          id: true,
          nickname: true,
          brand: true,
          lastFour: true,
          form: true,
          isAdditional: true,
          sharedPurchases: true,
          archivedAt: true,
          holder: { select: { name: true } },
        },
      },
    },
  });
  return rows.map((a) => ({ ...a, initialBalance: fromDbDecimal(a.initialBalance) }));
}

export type NewAccountInput = {
  name: string;
  kind: AccountKind;
  institution?: string | null;
  /** Só cartão de crédito (o banco exige os dois juntos, CHECK do M04) */
  closingDay?: number | null;
  dueDay?: number | null;
  initialBalance?: bigint;
};

/** Cria uma conta na carteira; o titular é quem cria. */
export async function createAccount(
  db: PrismaClient,
  grant: WalletGrant<"manage_accounts">,
  input: NewAccountInput,
  ctx: RequestContext,
) {
  const isCard = input.kind === "CREDIT_CARD";
  return db.$transaction(async (tx) => {
    const account = await tx.financialAccount.create({
      data: {
        householdId: grant.wallet.householdId,
        walletId: grant.wallet.id,
        holderId: grant.userId,
        name: input.name,
        kind: input.kind,
        institution: input.institution ?? null,
        closingDay: isCard ? (input.closingDay ?? null) : null,
        dueDay: isCard ? (input.dueDay ?? null) : null,
        initialBalance: toDbDecimal(input.initialBalance ?? 0n),
      },
    });
    await writeAudit(
      tx,
      {
        actorId: grant.userId,
        householdId: grant.wallet.householdId,
        action: "account.created",
        entity: "financial_account",
        entityId: account.id,
        metadata: { kind: input.kind, walletId: grant.wallet.id },
      },
      ctx,
    );
    return account;
  });
}

/** Arquiva (ou desarquiva) uma conta da carteira. Os lançamentos antigos continuam. */
export async function setAccountArchived(
  db: PrismaClient,
  grant: WalletGrant<"manage_accounts">,
  accountId: string,
  archived: boolean,
  ctx: RequestContext,
) {
  await db.$transaction(async (tx) => {
    // walletId no filtro: o id veio do formulário e pode ser de outra carteira (IDOR)
    const { count } = await tx.financialAccount.updateMany({
      where: { id: accountId, walletId: grant.wallet.id },
      data: { archivedAt: archived ? new Date() : null },
    });
    if (count === 0) throw new DomainError("NOT_FOUND");
    await writeAudit(
      tx,
      {
        actorId: grant.userId,
        householdId: grant.wallet.householdId,
        action: "account.archived",
        entity: "financial_account",
        entityId: accountId,
        metadata: { archived },
      },
      ctx,
    );
  });
}

export type NewCardInput = {
  nickname: string;
  brand: string;
  lastFour: string;
  form: "PHYSICAL" | "VIRTUAL" | "VIRTUAL_TEMPORARY";
  /** Portador: quem usa o cartão. Precisa ser do lar. Padrão: quem cadastra */
  holderId?: string | null;
  isAdditional: boolean;
  /** Cartão de compras conjuntas: o que se compra com ele é "Compartilhado" (M07.4) */
  sharedPurchases?: boolean;
};

/** Cadastra um cartão numa conta de cartão de crédito (ou de vale) da carteira. */
export async function createCard(
  db: PrismaClient,
  grant: WalletGrant<"manage_accounts">,
  accountId: string,
  input: NewCardInput,
  ctx: RequestContext,
) {
  return db.$transaction(async (tx) => {
    const account = await tx.financialAccount.findFirst({
      where: { id: accountId, walletId: grant.wallet.id, archivedAt: null },
      select: { id: true, kind: true },
    });
    if (!account) throw new DomainError("NOT_FOUND");
    const holderId = input.holderId || grant.userId;
    const inHousehold = await tx.householdMember.count({
      where: { householdId: grant.wallet.householdId, userId: holderId },
    });
    if (inHousehold === 0) throw new DomainError("CARD_HOLDER_OUTSIDE_HOUSEHOLD");

    const card = await tx.paymentCard.create({
      data: {
        accountId: account.id,
        holderId,
        nickname: input.nickname,
        brand: input.brand,
        lastFour: input.lastFour,
        form: input.form,
        isAdditional: input.isAdditional,
        sharedPurchases: input.sharedPurchases ?? false,
      },
    });
    await writeAudit(
      tx,
      {
        actorId: grant.userId,
        householdId: grant.wallet.householdId,
        action: "card.created",
        entity: "payment_card",
        entityId: card.id,
        // Sem os 4 finais: a auditoria nunca guarda número de cartão
        metadata: {
          accountId: account.id,
          form: input.form,
          isAdditional: input.isAdditional,
          sharedPurchases: input.sharedPurchases ?? false,
        },
      },
      ctx,
    );
    return card;
  });
}

/** Arquiva (ou desarquiva) um cartão de uma conta da carteira. */
export async function setCardArchived(
  db: PrismaClient,
  grant: WalletGrant<"manage_accounts">,
  cardId: string,
  archived: boolean,
  ctx: RequestContext,
) {
  await db.$transaction(async (tx) => {
    const { count } = await tx.paymentCard.updateMany({
      where: { id: cardId, account: { walletId: grant.wallet.id } },
      data: { archivedAt: archived ? new Date() : null },
    });
    if (count === 0) throw new DomainError("NOT_FOUND");
    await writeAudit(
      tx,
      {
        actorId: grant.userId,
        householdId: grant.wallet.householdId,
        action: "card.archived",
        entity: "payment_card",
        entityId: cardId,
        metadata: { archived },
      },
      ctx,
    );
  });
}

/**
 * Marca (ou desmarca) um cartão como de compras conjuntas (M07.4). Muda só quem aparece em
 * "Pago por" nos lançamentos dele, inclusive os antigos (é calculado, não guardado).
 */
export async function setCardSharedPurchases(
  db: PrismaClient,
  grant: WalletGrant<"manage_accounts">,
  cardId: string,
  sharedPurchases: boolean,
  ctx: RequestContext,
) {
  await db.$transaction(async (tx) => {
    const { count } = await tx.paymentCard.updateMany({
      where: { id: cardId, account: { walletId: grant.wallet.id } },
      data: { sharedPurchases },
    });
    if (count === 0) throw new DomainError("NOT_FOUND");
    await writeAudit(
      tx,
      {
        actorId: grant.userId,
        householdId: grant.wallet.householdId,
        action: "card.shared_purchases_changed",
        entity: "payment_card",
        entityId: cardId,
        metadata: { sharedPurchases },
      },
      ctx,
    );
  });
}
