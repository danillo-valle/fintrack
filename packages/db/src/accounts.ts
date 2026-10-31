// Contas e cartões (M07): de onde o dinheiro sai e para onde entra.
//
// Uma conta é gerida numa carteira (walletId): criar e arquivar conta ou cartão pede o crachá
// "manage_accounts" daquela carteira (só o dono). LANÇAR numa conta é outra pergunta,
// respondida por authorizeAccountUse (access.ts): quem edita a carteira da conta, ou quem é
// portador de um cartão dela (o adicional do cônjuge).
//
// Cartão: só os 4 últimos dígitos (CHECK no banco). Nunca o número inteiro, validade ou CVV.
import { canSwitchAccountKind, importWalletFor, type AccountKind } from "@fintrack/core";
import { DomainError, type WalletGrant } from "./access";
import { writeAudit, type RequestContext } from "./audit";
import type { PrismaClient } from "./generated/prisma/client";
import { fromDbDecimal, toDbDecimal } from "./money";
import { rerouteReceived } from "./review";
import { personalWalletsOf } from "./sync";

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
      holderId: true,
      holder: { select: { name: true } },
      // M13.2: ligada ao banco (o tipo vem dele e não muda no Editar conta)
      connectionId: true,
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
          holderId: true,
          holder: { select: { name: true } },
          // M13.1: para onde vão as compras deste cartão que vêm do banco (nulo = a regra padrão)
          importWalletId: true,
          importWallet: { select: { name: true, kind: true } },
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

export type AccountUpdateInput = {
  /** O apelido que o FinTrack mostra */
  name: string;
  /** Só numa conta manual, entre corrente, poupança e dinheiro (canSwitchAccountKind) */
  kind: AccountKind;
};

/**
 * Editar conta (M13.2): o apelido em qualquer conta ativa da carteira; o tipo só numa conta que
 * não é ligada ao banco e só entre os trocáveis. A conta do banco guarda o nome que ele manda
 * (`externalId` e a instituição continuam). Auditoria só com os nomes dos campos que mudaram.
 */
export async function updateAccount(
  db: PrismaClient,
  grant: WalletGrant<"manage_accounts">,
  accountId: string,
  input: AccountUpdateInput,
  ctx: RequestContext,
) {
  await db.$transaction(async (tx) => {
    // walletId no filtro: o id veio do formulário e pode ser de outra carteira (IDOR)
    const current = await tx.financialAccount.findFirst({
      where: { id: accountId, walletId: grant.wallet.id, archivedAt: null },
      select: { name: true, kind: true, connectionId: true },
    });
    if (!current) throw new DomainError("NOT_FOUND");
    if (
      input.kind !== current.kind &&
      (current.connectionId !== null || !canSwitchAccountKind(current.kind, input.kind))
    ) {
      throw new DomainError("ACCOUNT_KIND_LOCKED");
    }
    const changed = [
      ...(input.name !== current.name ? ["name"] : []),
      ...(input.kind !== current.kind ? ["kind"] : []),
    ];
    await tx.financialAccount.update({
      where: { id: accountId },
      data: { name: input.name, kind: input.kind },
    });
    await writeAudit(
      tx,
      {
        actorId: grant.userId,
        householdId: grant.wallet.householdId,
        action: "account.updated",
        entity: "financial_account",
        entityId: accountId,
        metadata: { changed },
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
    // M09.2: os recebidos do banco com este final (um adicional que chegou antes do cadastro)
    // vão agora para o cartão e para o ambiente do portador
    const rerouted = await rerouteReceived(tx, account.id);
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
          rerouted,
        },
      },
      ctx,
    );
    return { ...card, rerouted };
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
    // M09.2: os recebidos do final saem do cartão arquivado (ou voltam para ele)
    const card = await tx.paymentCard.findUniqueOrThrow({
      where: { id: cardId },
      select: { accountId: true },
    });
    await rerouteReceived(tx, card.accountId);
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

/**
 * Os ambientes do lar em que as compras de um cartão podem entrar (M09.1; M13.1 também no Editar
 * cartão): os ativos, com quem participa de cada um. A tela só oferece os de que o PORTADOR
 * participa (senão ele não veria as próprias compras); o servidor confere de novo ao gravar.
 */
export async function householdWalletOptions(db: PrismaClient, householdId: string) {
  const wallets = await db.wallet.findMany({
    where: { householdId, archivedAt: null },
    orderBy: [{ kind: "asc" }, { name: "asc" }],
    select: { id: true, name: true, kind: true, members: { select: { userId: true, role: true } } },
  });
  return wallets.map((w) => ({
    id: w.id,
    name: w.name,
    kind: w.kind,
    memberIds: w.members.map((m) => m.userId),
    ownerIds: w.members.filter((m) => m.role === "OWNER").map((m) => m.userId),
  }));
}

export type CardUpdateInput = {
  nickname: string;
  brand: string;
  form: "PHYSICAL" | "VIRTUAL" | "VIRTUAL_TEMPORARY";
  /** Portador: quem usa o cartão. Precisa ser do lar */
  holderId: string;
  isAdditional: boolean;
  sharedPurchases: boolean;
  /** Ambiente das compras que vêm do banco; nulo = a regra padrão (importWalletFor) */
  importWalletId: string | null;
};

/**
 * Editar cartão (M13.1, prancha L-EditarCartao). Tudo menos o final: outro final é outro cartão.
 * Só cartão ativo de uma conta da carteira (crachá "manage_accounts"); qualquer outro id responde
 * NOT_FOUND igual (IDOR). O portador precisa ser do lar, e o ambiente de entrada, um ambiente ativo
 * do lar de que o portador participa (a mesma regra do "Ligar as contas").
 *
 * Os recebidos ainda não confirmados deste cartão que estavam no ambiente que a configuração
 * ANTIGA dava vão para o que a nova dá; um recebido que a pessoa já moveu à mão fica onde está
 * (a mesma regra da busca, rerouteWallet). O que já foi confirmado nunca muda.
 */
export async function updateCard(
  db: PrismaClient,
  grant: WalletGrant<"manage_accounts">,
  cardId: string,
  input: CardUpdateInput,
  ctx: RequestContext,
) {
  return db.$transaction(async (tx) => {
    const card = await tx.paymentCard.findFirst({
      where: { id: cardId, archivedAt: null, account: { walletId: grant.wallet.id } },
      select: {
        id: true,
        accountId: true,
        nickname: true,
        brand: true,
        form: true,
        holderId: true,
        isAdditional: true,
        sharedPurchases: true,
        importWalletId: true,
        account: { select: { walletId: true, holderId: true, householdId: true } },
      },
    });
    if (!card) throw new DomainError("NOT_FOUND");
    const householdId = card.account.householdId;
    const inHousehold = await tx.householdMember.count({
      where: { householdId, userId: input.holderId },
    });
    if (inHousehold === 0) throw new DomainError("CARD_HOLDER_OUTSIDE_HOUSEHOLD");
    if (input.importWalletId) {
      const wallet = await tx.wallet.findFirst({
        where: { id: input.importWalletId, householdId, archivedAt: null },
        select: { members: { where: { userId: input.holderId }, select: { userId: true } } },
      });
      if (!wallet) throw new DomainError("NOT_FOUND");
      if (wallet.members.length === 0) throw new DomainError("CARD_WALLET_WITHOUT_HOLDER");
    }

    const personalWallets = await personalWalletsOf(tx, householdId);
    const walletFor = (c: { holderId: string | null; importWalletId: string | null }) =>
      importWalletFor({ account: card.account, card: c, personalWallets }).walletId;
    // Escolher o mesmo ambiente que a regra padrão já daria grava "padrão" (nulo): assim o cartão
    // continua seguindo a regra se o portador ou a conta mudarem depois
    const saved: CardUpdateInput = {
      ...input,
      importWalletId:
        input.importWalletId === walletFor({ holderId: input.holderId, importWalletId: null })
          ? null
          : input.importWalletId,
    };
    await tx.paymentCard.update({ where: { id: card.id }, data: saved });

    // Os recebidos deste cartão vão para o ambiente que a configuração nova dá
    const before = walletFor(card);
    const after = walletFor(saved);
    let moved = 0;
    if (before !== after) {
      const result = await tx.transaction.updateMany({
        where: { cardId: card.id, status: "PENDING", deletedAt: null, walletId: before },
        data: { walletId: after },
      });
      moved = result.count;
    }

    const changed = (Object.keys(saved) as (keyof CardUpdateInput)[]).filter(
      (key) => saved[key] !== card[key],
    );
    await writeAudit(
      tx,
      {
        actorId: grant.userId,
        householdId,
        action: "card.updated",
        entity: "payment_card",
        entityId: card.id,
        // Só QUAIS campos mudaram (nunca o final, nunca nomes): a auditoria é só de metadados
        metadata: { accountId: card.accountId, changed, moved },
      },
      ctx,
    );
    return { id: card.id, accountId: card.accountId, moved };
  });
}
