// Autorização por recurso (M06): o ponto único que responde "esta pessoa pode fazer isto
// nesta carteira / neste lar?". Prevenção de IDOR, OWASP A01:2025 (Broken Access Control).
//
// IDOR = Insecure Direct Object Reference: a URL ou o formulário trazem um id
// (/carteiras/0199...) e o servidor confia nele. Se o código buscar "a carteira com este id"
// sem perguntar "e quem está pedindo participa dela?", basta trocar o id para ver a carteira
// de outra pessoa. Aqui a busca já nasce filtrada pela pessoa: procuramos o VÍNCULO
// (wallet_member com walletId E userId), nunca a carteira solta.
//
// O resultado positivo é um "crachá" (WalletGrant / HouseholdGrant). As operações que mudam
// dados (wallets.ts, households.ts) só aceitam um crachá da ação certa, então esquecer a
// checagem vira ERRO DE COMPILAÇÃO, e não uma falha descoberta em produção:
//
//   const access = await authorizeWallet(prisma, user.id, walletId, "rename");
//   if (!access.ok) ...                         // 404 ou "seu papel não permite"
//   await renameWallet(prisma, access.grant, "Casa", ctx);  // compila: crachá de "rename"
//   await renameWallet(prisma, viewGrant, "Casa", ctx);     // NÃO compila: crachá de "view"
import {
  canInHousehold,
  canInWallet,
  type HouseholdAction,
  type HouseholdRole,
  type WalletAction,
  type WalletDenialReason,
  type WalletKind,
  type WalletRole,
} from "@fintrack/core";
import type { PrismaClient } from "./generated/prisma/client";

// Marca de tipo que só existe neste arquivo. Sem ela, qualquer objeto com os mesmos campos
// passaria por crachá. Com ela, só as funções daqui conseguem criar um (sem "as" forçado).
declare const grantBrand: unique symbol;

/** Prova de que `userId` pode fazer `action` na carteira `walletId`. Só authorizeWallet cria. */
export type WalletGrant<A extends WalletAction = WalletAction> = {
  readonly [grantBrand]: A;
  readonly action: A;
  readonly userId: string;
  readonly role: WalletRole;
  readonly wallet: {
    readonly id: string;
    readonly householdId: string;
    readonly name: string;
    readonly kind: WalletKind;
    readonly archivedAt: Date | null;
  };
};

/** Prova de que `userId` pode fazer `action` no lar dele. Só authorizeHousehold cria. */
export type HouseholdGrant<A extends HouseholdAction = HouseholdAction> = {
  readonly [grantBrand]: A;
  readonly action: A;
  readonly userId: string;
  readonly role: HouseholdRole;
  readonly household: { readonly id: string; readonly name: string };
};

/**
 * Motivos de recusa.
 *   NOT_FOUND  a carteira não existe OU a pessoa não participa dela. As duas situações dão
 *              a MESMA resposta (404): responder 403 confirmaria que o id existe.
 *   ROLE / PERSONAL_WALLET / ARCHIVED  a pessoa participa, mas o papel ou o estado não deixam.
 */
export type WalletAccess<A extends WalletAction> =
  { ok: true; grant: WalletGrant<A> } | { ok: false; reason: "NOT_FOUND" | WalletDenialReason };

export type HouseholdAccess<A extends HouseholdAction> =
  { ok: true; grant: HouseholdGrant<A> } | { ok: false; reason: "NO_HOUSEHOLD" | "ROLE" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** O texto tem formato de UUID? Evita mandar lixo ao banco (a coluna é uuid e daria erro 500). */
export function isUuid(value: string): boolean {
  return UUID.test(value);
}

/**
 * Pode `userId` fazer `action` na carteira `walletId`? UMA consulta: o vínculo da pessoa com
 * a carteira. O vínculo só existe para quem é do mesmo lar (chave estrangeira composta do M04),
 * então gente de outro lar nunca passa daqui, nem por engano no código de cima.
 */
export async function authorizeWallet<A extends WalletAction>(
  db: PrismaClient,
  userId: string,
  walletId: string,
  action: A,
): Promise<WalletAccess<A>> {
  if (!isUuid(walletId)) return { ok: false, reason: "NOT_FOUND" };

  const membership = await db.walletMember.findUnique({
    where: { walletId_userId: { walletId, userId } },
    select: {
      role: true,
      wallet: {
        select: { id: true, householdId: true, name: true, kind: true, archivedAt: true },
      },
    },
  });
  if (!membership) return { ok: false, reason: "NOT_FOUND" };

  const { role, wallet } = membership;
  const decision = canInWallet(role, action, { kind: wallet.kind, archived: !!wallet.archivedAt });
  if (!decision.allowed) return { ok: false, reason: decision.reason };

  return { ok: true, grant: { action, userId, role, wallet } as WalletGrant<A> };
}

/**
 * Lar da pessoa e o que ela pode fazer nele. O modelo aceita uma pessoa em vários lares;
 * por enquanto o app usa um por pessoa (o mais antigo). Escolher entre lares é uma feature
 * futura (ADR-006), sem mudar o banco.
 */
export async function authorizeHousehold<A extends HouseholdAction>(
  db: PrismaClient,
  userId: string,
  action: A,
): Promise<HouseholdAccess<A>> {
  const membership = await db.householdMember.findFirst({
    where: { userId },
    orderBy: { joinedAt: "asc" },
    select: { role: true, household: { select: { id: true, name: true } } },
  });
  if (!membership) return { ok: false, reason: "NO_HOUSEHOLD" };
  if (!canInHousehold(membership.role, action)) return { ok: false, reason: "ROLE" };

  return {
    ok: true,
    grant: {
      action,
      userId,
      role: membership.role,
      household: membership.household,
    } as HouseholdGrant<A>,
  };
}

/**
 * Erro de regra do domínio, com um código estável. A tela traduz o código para uma frase
 * (apps/web/src/lib/access-messages.ts); o código também vai para o log.
 */
export class DomainError extends Error {
  constructor(
    readonly code: DomainErrorCode,
    readonly details: Record<string, unknown> = {},
  ) {
    super(code);
    this.name = "DomainError";
  }
}

export type DomainErrorCode =
  | "ALREADY_IN_HOUSEHOLD" // já participa de um lar (um por pessoa, por enquanto)
  | "ALREADY_MEMBER" // a pessoa já está no lar ou na carteira
  | "NOT_HOUSEHOLD_MEMBER" // só gente do lar entra numa carteira dele
  | "NOT_A_MEMBER" // a pessoa não participa da carteira
  | "LAST_OWNER" // a carteira ficaria sem dono
  | "SOLE_WALLET_OWNER" // tirar do lar deixaria uma carteira compartilhada sem dono
  | "CANNOT_REMOVE_SELF" // o dono do lar não se remove
  | "CANNOT_REMOVE_OWNER" // dono do lar não é removido por outro dono (M06)
  | "INVITE_INVALID" // convite inexistente, expirado, cancelado ou já usado
  | "INVITE_WRONG_ACCOUNT" // convite de outro e-mail
  | "STALE_GRANT" // o papel mudou entre a checagem e a gravação
  | "NOT_FOUND";
