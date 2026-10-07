// O lar: criar, convidar, aceitar convite, tirar alguém (M06).
//
// Cada função que muda dados:
//   1. recebe um crachá (HouseholdGrant) da ação certa, ou faz a própria checagem quando não
//      há lar ainda (criar o lar, aceitar convite);
//   2. roda numa transação;
//   3. grava a auditoria dentro da mesma transação.
import { createHash, randomBytes } from "node:crypto";
import { INVITE_TTL_MS, inviteStatus, normalizeEmail, type HouseholdRole } from "@fintrack/core";
import { DomainError, type HouseholdGrant } from "./access";
import { maskEmail, writeAudit, type RequestContext } from "./audit";
import type { Prisma, PrismaClient } from "./generated/prisma/client";

// ── Segredo do link de convite ──────────────────────────────────────────────────

/** 32 bytes aleatórios em base64url: 43 caracteres, 256 bits. Impossível de adivinhar. */
export function newInviteToken(): string {
  return randomBytes(32).toString("base64url");
}

/** O banco guarda só o SHA-256 do segredo. Sem sal: o segredo já é aleatório e longo. */
export function hashInviteToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Formato do segredo (43 caracteres de base64url). Texto fora do formato nem vai ao banco. */
export function isInviteToken(value: string): boolean {
  return /^[A-Za-z0-9_-]{43}$/.test(value);
}

// ── Travas ──────────────────────────────────────────────────────────────────────

/**
 * Trava por pessoa durante a transação (advisory lock do Postgres). Dois cliques seguidos em
 * "Criar lar", ou aceitar dois convites ao mesmo tempo, esperam um pelo outro. Assim a
 * conferência "você já tem um lar?" não é enganada por duas requisições simultâneas.
 * A trava some sozinha no COMMIT ou no ROLLBACK.
 */
async function lockPerson(tx: Prisma.TransactionClient, userId: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`household:${userId}`}, 0))`;
}

/** Cria a carteira pessoal da pessoa no lar, com ela como dona. */
async function createPersonalWallet(
  tx: Prisma.TransactionClient,
  householdId: string,
  user: { id: string; name: string },
  ctx: RequestContext,
) {
  const wallet = await tx.wallet.create({
    data: {
      householdId,
      name: user.name.slice(0, 60),
      kind: "PERSONAL",
      createdById: user.id,
      members: { create: { userId: user.id, role: "OWNER" } },
    },
  });
  await writeAudit(
    tx,
    {
      actorId: user.id,
      householdId,
      action: "wallet.created",
      entity: "wallet",
      entityId: wallet.id,
      metadata: { kind: "PERSONAL" },
    },
    ctx,
  );
  return wallet;
}

// ── Criar o lar ─────────────────────────────────────────────────────────────────

/**
 * Cria o lar com a pessoa como dona e a carteira pessoal dela. Não precisa de crachá: quem
 * ainda não tem lar não tem o que acessar; a regra é "uma pessoa, um lar" (por enquanto).
 */
export async function createHousehold(
  db: PrismaClient,
  input: { user: { id: string; name: string }; name: string },
  ctx: RequestContext,
) {
  return db.$transaction(async (tx) => {
    await lockPerson(tx, input.user.id);
    const existing = await tx.householdMember.count({ where: { userId: input.user.id } });
    if (existing > 0) throw new DomainError("ALREADY_IN_HOUSEHOLD");

    const household = await tx.household.create({
      data: { name: input.name, members: { create: { userId: input.user.id, role: "OWNER" } } },
    });
    await writeAudit(
      tx,
      {
        actorId: input.user.id,
        householdId: household.id,
        action: "household.created",
        entity: "household",
        entityId: household.id,
      },
      ctx,
    );
    const wallet = await createPersonalWallet(tx, household.id, input.user, ctx);
    return { household, personalWallet: wallet };
  });
}

// ── Convites ────────────────────────────────────────────────────────────────────

/**
 * Cria um convite e devolve o SEGREDO do link. Esta é a única vez que o segredo existe em
 * texto: o banco guarda só o hash. Convites abertos para o mesmo e-mail são cancelados
 * (o link novo substitui o antigo).
 */
export async function createInvite(
  db: PrismaClient,
  grant: HouseholdGrant<"invite">,
  input: { email: string; role: HouseholdRole },
  ctx: RequestContext,
  now: Date = new Date(),
) {
  const email = normalizeEmail(input.email);
  const householdId = grant.household.id;

  return db.$transaction(async (tx) => {
    // Quem já está no lar não precisa de convite (compara sem maiúsculas)
    const already = await tx.householdMember.findFirst({
      where: { householdId, user: { email: { equals: email, mode: "insensitive" } } },
      select: { userId: true },
    });
    if (already) throw new DomainError("ALREADY_MEMBER");

    const replaced = await tx.householdInvite.updateMany({
      where: { householdId, email, acceptedAt: null, revokedAt: null },
      data: { revokedAt: now },
    });

    const token = newInviteToken();
    const invite = await tx.householdInvite.create({
      data: {
        householdId,
        tokenHash: hashInviteToken(token),
        email,
        role: input.role,
        createdById: grant.userId,
        createdAt: now,
        expiresAt: new Date(now.getTime() + INVITE_TTL_MS),
      },
    });
    await writeAudit(
      tx,
      {
        actorId: grant.userId,
        householdId,
        action: "household.invite_created",
        entity: "household_invite",
        entityId: invite.id,
        metadata: { email: maskEmail(email), role: input.role, replaced: replaced.count },
      },
      ctx,
    );
    return { invite, token };
  });
}

/** Cancela um convite ainda aberto do próprio lar. Convite de outro lar = NOT_FOUND. */
export async function revokeInvite(
  db: PrismaClient,
  grant: HouseholdGrant<"invite">,
  inviteId: string,
  ctx: RequestContext,
) {
  return db.$transaction(async (tx) => {
    // householdId no filtro: o id veio do formulário e pode ser de outro lar (IDOR)
    const { count } = await tx.householdInvite.updateMany({
      where: { id: inviteId, householdId: grant.household.id, acceptedAt: null, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (count === 0) throw new DomainError("NOT_FOUND");
    await writeAudit(
      tx,
      {
        actorId: grant.userId,
        householdId: grant.household.id,
        action: "household.invite_revoked",
        entity: "household_invite",
        entityId: inviteId,
      },
      ctx,
    );
  });
}

/** Convites do lar ainda abertos (pendentes ou expirados sem uso), para a tela do dono. */
export async function listOpenInvites(db: PrismaClient, grant: HouseholdGrant<"invite">) {
  return db.householdInvite.findMany({
    where: { householdId: grant.household.id, acceptedAt: null, revokedAt: null },
    orderBy: { createdAt: "desc" },
    select: { id: true, email: true, role: true, createdAt: true, expiresAt: true },
  });
}

/**
 * O que a tela /convite/<segredo> mostra antes de a pessoa aceitar. Devolve null para
 * qualquer segredo que não seja de um convite (formato errado ou inexistente).
 */
export async function findInviteByToken(db: PrismaClient, token: string, now = new Date()) {
  if (!isInviteToken(token)) return null;
  const invite = await db.householdInvite.findUnique({
    where: { tokenHash: hashInviteToken(token) },
    select: {
      email: true,
      role: true,
      expiresAt: true,
      acceptedAt: true,
      revokedAt: true,
      household: { select: { name: true } },
      createdBy: { select: { name: true } },
    },
  });
  if (!invite) return null;
  return {
    status: inviteStatus(invite, now),
    email: invite.email,
    role: invite.role,
    householdName: invite.household.name,
    inviterName: invite.createdBy?.name ?? null,
  };
}

/**
 * Aceita o convite: a pessoa entra no lar com o papel do convite e ganha a carteira pessoal.
 *
 * Uso único de verdade: o UPDATE só marca o convite se ele AINDA estiver aberto e no prazo
 * (WHERE acceptedAt IS NULL AND revokedAt IS NULL AND expiresAt > agora). Se duas abas
 * aceitarem ao mesmo tempo, o Postgres deixa só uma mudar a linha; a outra recebe count = 0.
 */
export async function acceptInvite(
  db: PrismaClient,
  input: { token: string; user: { id: string; name: string; email: string } },
  ctx: RequestContext,
  now: Date = new Date(),
) {
  if (!isInviteToken(input.token)) throw new DomainError("INVITE_INVALID");

  return db.$transaction(async (tx) => {
    await lockPerson(tx, input.user.id);

    const invite = await tx.householdInvite.findUnique({
      where: { tokenHash: hashInviteToken(input.token) },
    });
    if (!invite || inviteStatus(invite, now) !== "PENDING") {
      throw new DomainError("INVITE_INVALID");
    }
    if (normalizeEmail(input.user.email) !== invite.email) {
      throw new DomainError("INVITE_WRONG_ACCOUNT");
    }
    const existing = await tx.householdMember.count({ where: { userId: input.user.id } });
    if (existing > 0) throw new DomainError("ALREADY_IN_HOUSEHOLD");

    const { count } = await tx.householdInvite.updateMany({
      where: { id: invite.id, acceptedAt: null, revokedAt: null, expiresAt: { gt: now } },
      data: { acceptedAt: now, acceptedById: input.user.id },
    });
    if (count === 0) throw new DomainError("INVITE_INVALID"); // outra aba chegou antes

    await tx.householdMember.create({
      data: { householdId: invite.householdId, userId: input.user.id, role: invite.role },
    });
    await writeAudit(
      tx,
      {
        actorId: input.user.id,
        householdId: invite.householdId,
        action: "household.invite_accepted",
        entity: "household_invite",
        entityId: invite.id,
        metadata: { role: invite.role },
      },
      ctx,
    );
    const wallet = await createPersonalWallet(tx, invite.householdId, input.user, ctx);
    return { householdId: invite.householdId, personalWallet: wallet };
  });
}

// ── Pessoas do lar ──────────────────────────────────────────────────────────────

/** Quem participa do lar, donos primeiro. */
export async function listHouseholdMembers(db: PrismaClient, grant: HouseholdGrant<"view">) {
  return db.householdMember.findMany({
    where: { householdId: grant.household.id },
    orderBy: [{ role: "asc" }, { joinedAt: "asc" }],
    select: {
      userId: true,
      role: true,
      joinedAt: true,
      user: { select: { name: true, email: true } },
    },
  });
}

/**
 * Tira uma pessoa do lar. A chave estrangeira em cascata (M04) já a tira de todas as
 * carteiras do lar; a carteira pessoal dela é ARQUIVADA, não apagada: os lançamentos
 * continuam no histórico do lar. Recusa se a saída deixar uma carteira compartilhada sem dono.
 */
export async function removeHouseholdMember(
  db: PrismaClient,
  grant: HouseholdGrant<"remove_member">,
  targetUserId: string,
  ctx: RequestContext,
) {
  if (targetUserId === grant.userId) throw new DomainError("CANNOT_REMOVE_SELF");
  const householdId = grant.household.id;

  return db.$transaction(async (tx) => {
    const target = await tx.householdMember.findUnique({
      where: { householdId_userId: { householdId, userId: targetUserId } },
    });
    if (!target) throw new DomainError("NOT_FOUND");
    if (target.role === "OWNER") throw new DomainError("CANNOT_REMOVE_OWNER");

    // Carteiras compartilhadas em que a pessoa é a ÚNICA dona
    const owned = await tx.wallet.findMany({
      where: {
        householdId,
        kind: "SHARED",
        members: { some: { userId: targetUserId, role: "OWNER" } },
      },
      select: { name: true, members: { where: { role: "OWNER" }, select: { userId: true } } },
    });
    const sole = owned.filter((w) => w.members.length === 1).map((w) => w.name);
    if (sole.length > 0) throw new DomainError("SOLE_WALLET_OWNER", { wallets: sole });

    await tx.wallet.updateMany({
      where: { householdId, kind: "PERSONAL", createdById: targetUserId, archivedAt: null },
      data: { archivedAt: new Date() },
    });
    await tx.householdMember.delete({
      where: { householdId_userId: { householdId, userId: targetUserId } },
    });
    await writeAudit(
      tx,
      {
        actorId: grant.userId,
        householdId,
        action: "household.member_removed",
        entity: "household_member",
        entityId: targetUserId,
      },
      ctx,
    );
  });
}

/** Os últimos eventos do lar (trilha de auditoria), mais novos primeiro. */
export async function listHouseholdActivity(
  db: PrismaClient,
  grant: HouseholdGrant<"view_activity">,
  limit = 30,
) {
  const rows = await db.auditLog.findMany({
    where: { householdId: grant.household.id },
    orderBy: { id: "desc" },
    take: limit,
    select: { id: true, createdAt: true, actorId: true, action: true, entityId: true },
  });
  // Nomes de quem fez (sem chave estrangeira na auditoria: a pessoa pode ter saído)
  const actorIds = [...new Set(rows.flatMap((r) => (r.actorId ? [r.actorId] : [])))];
  const people = await db.user.findMany({
    where: { id: { in: actorIds } },
    select: { id: true, name: true },
  });
  const names = new Map(people.map((p) => [p.id, p.name]));
  return rows.map((r) => ({
    id: r.id.toString(), // BigInt não atravessa para a tela; vira texto
    createdAt: r.createdAt,
    action: r.action,
    actorName: r.actorId ? (names.get(r.actorId) ?? "Pessoa removida") : "Sistema",
  }));
}
