// Carteiras (ambientes): criar, renomear, arquivar e cuidar de quem participa (M06).
//
// Toda função que muda uma carteira existente recebe um WalletGrant da ação certa
// (veja access.ts) e, dentro da transação, TRAVA a carteira e relê os membros:
//
//   SELECT id FROM wallet WHERE id = $1 FOR UPDATE
//
// Por quê: entre a checagem (authorizeWallet) e a gravação passam alguns milissegundos. Se
// dois donos se rebaixarem ao mesmo tempo, cada um "vê" o outro ainda dono e os dois passam;
// a carteira fica sem dono. Com a trava, o segundo espera o primeiro terminar e relê a lista
// já mudada. A releitura também pega o crachá velho: quem foi rebaixado no meio do caminho
// não consegue mais administrar (STALE_GRANT).
import {
  canInWallet,
  checkMembershipChange,
  type MembershipChange,
  type WalletRole,
} from "@fintrack/core";
import { DomainError, type HouseholdGrant, type WalletGrant } from "./access";
import { writeAudit, type RequestContext } from "./audit";
import type { Prisma, PrismaClient } from "./generated/prisma/client";

/** Carteiras de que a pessoa participa (o filtro é o vínculo dela: nunca aparece a de outro). */
export async function listMyWallets(db: PrismaClient, userId: string) {
  const rows = await db.walletMember.findMany({
    where: { userId },
    select: {
      role: true,
      wallet: {
        select: {
          id: true,
          name: true,
          kind: true,
          archivedAt: true,
          _count: { select: { members: true } },
        },
      },
    },
  });
  // Ordem da tela: pessoal primeiro, arquivadas por último, depois por nome
  const rank = (w: { kind: string; archived: boolean }) =>
    (w.kind === "SHARED" ? 1 : 0) + (w.archived ? 2 : 0);
  return rows
    .map((r) => ({
      id: r.wallet.id,
      name: r.wallet.name,
      kind: r.wallet.kind,
      archived: r.wallet.archivedAt !== null,
      role: r.role,
      memberCount: r.wallet._count.members,
    }))
    .sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name, "pt-BR"));
}

/** Detalhes da carteira para a tela: só com crachá de "view". */
export async function getWalletDetails(db: PrismaClient, grant: WalletGrant<"view">) {
  const members = await db.walletMember.findMany({
    where: { walletId: grant.wallet.id },
    orderBy: [{ role: "asc" }, { createdAt: "asc" }],
    select: { userId: true, role: true, user: { select: { name: true, email: true } } },
  });
  return { ...grant.wallet, myRole: grant.role, members };
}

/** Pessoas do lar que ainda não estão na carteira (para o campo "adicionar pessoa"). */
export async function listAddableMembers(db: PrismaClient, grant: WalletGrant<"manage_members">) {
  return db.householdMember.findMany({
    where: {
      householdId: grant.wallet.householdId,
      walletMemberships: { none: { walletId: grant.wallet.id } },
    },
    orderBy: { joinedAt: "asc" },
    select: { userId: true, user: { select: { name: true } } },
  });
}

// ── Criar ───────────────────────────────────────────────────────────────────────

/**
 * Cria uma carteira compartilhada. Quem cria é sempre dona; as outras pessoas precisam ser
 * do mesmo lar (o banco também garante, pela chave composta do wallet_member).
 */
export async function createSharedWallet(
  db: PrismaClient,
  grant: HouseholdGrant<"create_wallet">,
  input: { name: string; members: { userId: string; role: WalletRole }[] },
  ctx: RequestContext,
) {
  const householdId = grant.household.id;
  const others = input.members.filter((m) => m.userId !== grant.userId);

  return db.$transaction(async (tx) => {
    if (others.length > 0) {
      const inHousehold = await tx.householdMember.count({
        where: { householdId, userId: { in: others.map((m) => m.userId) } },
      });
      if (inHousehold !== new Set(others.map((m) => m.userId)).size) {
        throw new DomainError("NOT_HOUSEHOLD_MEMBER");
      }
    }
    const wallet = await tx.wallet.create({
      data: {
        householdId,
        name: input.name,
        kind: "SHARED",
        createdById: grant.userId,
        members: {
          create: [{ userId: grant.userId, role: "OWNER" as const }, ...others],
        },
      },
    });
    await writeAudit(
      tx,
      {
        actorId: grant.userId,
        householdId,
        action: "wallet.created",
        entity: "wallet",
        entityId: wallet.id,
        metadata: { kind: "SHARED", members: others.length + 1 },
      },
      ctx,
    );
    return wallet;
  });
}

// ── Travar e reler ──────────────────────────────────────────────────────────────

/**
 * Trava a carteira até o fim da transação e devolve os membros atuais. Confere de novo,
 * com o papel ATUAL, se quem pediu ainda pode fazer a ação do crachá.
 */
async function lockWallet(tx: Prisma.TransactionClient, grant: WalletGrant) {
  await tx.$queryRaw`SELECT id FROM wallet WHERE id = ${grant.wallet.id}::uuid FOR UPDATE`;
  const wallet = await tx.wallet.findUniqueOrThrow({
    where: { id: grant.wallet.id },
    select: { kind: true, archivedAt: true, members: { select: { userId: true, role: true } } },
  });
  const me = wallet.members.find((m) => m.userId === grant.userId);
  if (
    !me ||
    !canInWallet(me.role, grant.action, { kind: wallet.kind, archived: !!wallet.archivedAt })
      .allowed
  ) {
    throw new DomainError("STALE_GRANT");
  }
  return wallet.members;
}

function assertChange(members: { userId: string; role: WalletRole }[], change: MembershipChange) {
  const error = checkMembershipChange(members, change);
  if (error) throw new DomainError(error);
}

// ── Mudar a carteira ────────────────────────────────────────────────────────────

export async function renameWallet(
  db: PrismaClient,
  grant: WalletGrant<"rename">,
  name: string,
  ctx: RequestContext,
) {
  await db.$transaction(async (tx) => {
    await lockWallet(tx, grant);
    await tx.wallet.update({ where: { id: grant.wallet.id }, data: { name } });
    await writeAudit(
      tx,
      {
        actorId: grant.userId,
        householdId: grant.wallet.householdId,
        action: "wallet.renamed",
        entity: "wallet",
        entityId: grant.wallet.id,
        metadata: { from: grant.wallet.name, to: name },
      },
      ctx,
    );
  });
}

/** Arquiva (esconde, sem apagar nada) ou restaura uma carteira compartilhada. */
export async function setWalletArchived(
  db: PrismaClient,
  grant: WalletGrant<"archive">,
  archived: boolean,
  ctx: RequestContext,
) {
  await db.$transaction(async (tx) => {
    await lockWallet(tx, grant);
    await tx.wallet.update({
      where: { id: grant.wallet.id },
      data: { archivedAt: archived ? new Date() : null },
    });
    await writeAudit(
      tx,
      {
        actorId: grant.userId,
        householdId: grant.wallet.householdId,
        action: archived ? "wallet.archived" : "wallet.restored",
        entity: "wallet",
        entityId: grant.wallet.id,
      },
      ctx,
    );
  });
}

// ── Quem participa ──────────────────────────────────────────────────────────────

export async function addWalletMember(
  db: PrismaClient,
  grant: WalletGrant<"manage_members">,
  input: { userId: string; role: WalletRole },
  ctx: RequestContext,
) {
  const { householdId, id: walletId } = grant.wallet;
  await db.$transaction(async (tx) => {
    const members = await lockWallet(tx, grant);
    assertChange(members, { type: "add", ...input });
    const inHousehold = await tx.householdMember.count({
      where: { householdId, userId: input.userId },
    });
    if (inHousehold === 0) throw new DomainError("NOT_HOUSEHOLD_MEMBER");

    await tx.walletMember.create({ data: { householdId, walletId, ...input } });
    await writeAudit(
      tx,
      {
        actorId: grant.userId,
        householdId,
        action: "wallet.member_added",
        entity: "wallet_member",
        entityId: walletId,
        metadata: { userId: input.userId, role: input.role },
      },
      ctx,
    );
  });
}

export async function setWalletMemberRole(
  db: PrismaClient,
  grant: WalletGrant<"manage_members">,
  input: { userId: string; role: WalletRole },
  ctx: RequestContext,
) {
  const { householdId, id: walletId } = grant.wallet;
  await db.$transaction(async (tx) => {
    const members = await lockWallet(tx, grant);
    assertChange(members, { type: "set_role", ...input });
    const from = members.find((m) => m.userId === input.userId)?.role;
    if (from === input.role) return; // nada muda: nada a registrar

    await tx.walletMember.update({
      where: { walletId_userId: { walletId, userId: input.userId } },
      data: { role: input.role },
    });
    await writeAudit(
      tx,
      {
        actorId: grant.userId,
        householdId,
        action: "wallet.role_changed",
        entity: "wallet_member",
        entityId: walletId,
        metadata: { userId: input.userId, from: from ?? null, to: input.role },
      },
      ctx,
    );
  });
}

export async function removeWalletMember(
  db: PrismaClient,
  grant: WalletGrant<"manage_members">,
  userId: string,
  ctx: RequestContext,
) {
  const { householdId, id: walletId } = grant.wallet;
  await db.$transaction(async (tx) => {
    const members = await lockWallet(tx, grant);
    assertChange(members, { type: "remove", userId });
    await tx.walletMember.delete({ where: { walletId_userId: { walletId, userId } } });
    await writeAudit(
      tx,
      {
        actorId: grant.userId,
        householdId,
        action: "wallet.member_removed",
        entity: "wallet_member",
        entityId: walletId,
        metadata: { userId },
      },
      ctx,
    );
  });
}

/** A própria pessoa sai de uma carteira compartilhada (o último dono não sai). */
export async function leaveWallet(
  db: PrismaClient,
  grant: WalletGrant<"leave">,
  ctx: RequestContext,
) {
  const { householdId, id: walletId } = grant.wallet;
  await db.$transaction(async (tx) => {
    const members = await lockWallet(tx, grant);
    assertChange(members, { type: "remove", userId: grant.userId });
    await tx.walletMember.delete({
      where: { walletId_userId: { walletId, userId: grant.userId } },
    });
    await writeAudit(
      tx,
      {
        actorId: grant.userId,
        householdId,
        action: "wallet.member_left",
        entity: "wallet_member",
        entityId: walletId,
      },
      ctx,
    );
  });
}
