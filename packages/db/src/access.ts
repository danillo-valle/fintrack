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
  // ── Lançamentos, contas e categorias (M07) ──
  | "ACCOUNT_ARCHIVED" // conta arquivada não recebe lançamento novo
  | "METHOD_NOT_ALLOWED" // forma de pagamento que a conta não aceita (mesma regra do gatilho)
  | "CARD_NOT_ALLOWED" // cartão de outra conta, arquivado ou que não é da pessoa
  | "CATEGORY_INVALID" // categoria de outro lar, arquivada ou do tipo errado (despesa × receita)
  | "CATEGORY_EXISTS" // já há uma categoria com esse nome no lar
  | "CATEGORY_IN_USE_AS_PARENT" // categoria com subcategorias ativas não é arquivada
  | "RULE_PATTERN_INVALID" // padrão da regra curto ou longo demais
  | "TRANSFER_READONLY" // transferência não se edita: exclua e lance de novo
  | "SAME_ACCOUNT" // transferência da conta para ela mesma
  | "CARD_HOLDER_OUTSIDE_HOUSEHOLD" // portador do cartão precisa ser do lar
  | "NOT_FOUND";

// ── M07: contas, lançamentos e listas que juntam várias carteiras ───────────────

/**
 * Prova de que `userId` pode LANÇAR na conta `account`. Duas portas:
 *   WALLET  a pessoa pode editar ("edit") a carteira que gere a conta; usa qualquer cartão dela
 *   CARD    a pessoa é PORTADORA de um cartão ativo da conta (o adicional do cônjuge): lança
 *           só com os próprios cartões (`cardIds`), sem ver o resto da fatura
 * Só authorizeAccountUse cria.
 */
export type AccountGrant = {
  readonly [grantBrand]: "use_account";
  readonly userId: string;
  readonly via: "WALLET" | "CARD";
  readonly account: {
    readonly id: string;
    readonly householdId: string;
    readonly walletId: string;
    readonly name: string;
    readonly kind: "CHECKING" | "SAVINGS" | "CREDIT_CARD" | "MEAL_VOUCHER" | "CASH";
  };
  /** Cartões ativos que esta pessoa pode usar nesta conta */
  readonly cardIds: readonly string[];
};

export type AccountAccess =
  { ok: true; grant: AccountGrant } | { ok: false; reason: "NOT_FOUND" | "ARCHIVED" };

/**
 * Pode `userId` lançar na conta `accountId`? Conta que a pessoa não alcança por nenhuma das
 * duas portas responde NOT_FOUND, igual a uma conta que não existe (sem confirmar que existe).
 */
export async function authorizeAccountUse(
  db: PrismaClient,
  userId: string,
  accountId: string,
): Promise<AccountAccess> {
  if (!isUuid(accountId)) return { ok: false, reason: "NOT_FOUND" };
  const account = await db.financialAccount.findUnique({
    where: { id: accountId },
    select: {
      id: true,
      householdId: true,
      walletId: true,
      name: true,
      kind: true,
      archivedAt: true,
      cards: { where: { archivedAt: null }, select: { id: true, holderId: true } },
    },
  });
  if (!account) return { ok: false, reason: "NOT_FOUND" };

  const viaWallet = await authorizeWallet(db, userId, account.walletId, "edit");
  const ownCards = account.cards.filter((c) => c.holderId === userId).map((c) => c.id);
  if (!viaWallet.ok && ownCards.length === 0) return { ok: false, reason: "NOT_FOUND" };
  if (account.archivedAt) return { ok: false, reason: "ARCHIVED" };

  const { id, householdId, walletId, name, kind } = account;
  return {
    ok: true,
    grant: {
      userId,
      via: viaWallet.ok ? "WALLET" : "CARD",
      account: { id, householdId, walletId, name, kind },
      cardIds: (viaWallet.ok ? account.cards.map((c) => c.id) : ownCards) as readonly string[],
    } as AccountGrant,
  };
}

/** Prova de que `userId` pode fazer `action` no lançamento. Só authorizeTransaction cria. */
export type TransactionGrant<A extends "view" | "edit" = "view" | "edit"> = {
  readonly [grantBrand]: A;
  readonly action: A;
  readonly userId: string;
  readonly transaction: {
    readonly id: string;
    readonly householdId: string;
    readonly walletId: string;
    readonly transferId: string | null;
    readonly deletedAt: Date | null;
  };
  /** O crachá da carteira do lançamento, com a mesma ação */
  readonly wallet: WalletGrant<A>;
};

export type TransactionAccess<A extends "view" | "edit"> =
  | { ok: true; grant: TransactionGrant<A> }
  | { ok: false; reason: "NOT_FOUND" | WalletDenialReason };

/**
 * Pode `userId` fazer `action` no lançamento `transactionId`? O id vem da URL
 * (/lancamentos/0199…): é a mesma porta de IDOR das carteiras. O lançamento é procurado pelo
 * id e a decisão é a da CARTEIRA dele (authorizeWallet). Lançamento excluído só aparece com
 * `includeDeleted` (o "desfazer" da exclusão).
 */
export async function authorizeTransaction<A extends "view" | "edit">(
  db: PrismaClient,
  userId: string,
  transactionId: string,
  action: A,
  options: { includeDeleted?: boolean } = {},
): Promise<TransactionAccess<A>> {
  if (!isUuid(transactionId)) return { ok: false, reason: "NOT_FOUND" };
  const transaction = await db.transaction.findUnique({
    where: { id: transactionId },
    select: { id: true, householdId: true, walletId: true, transferId: true, deletedAt: true },
  });
  if (!transaction || (transaction.deletedAt && !options.includeDeleted)) {
    return { ok: false, reason: "NOT_FOUND" };
  }
  const access = await authorizeWallet(db, userId, transaction.walletId, action);
  if (!access.ok) return { ok: false, reason: access.reason };
  return {
    ok: true,
    grant: { action, userId, transaction, wallet: access.grant } as TransactionGrant<A>,
  };
}

/**
 * Um conjunto de carteiras em que `userId` pode fazer `action`: a lista "todos os lançamentos
 * que vejo" junta várias carteiras, e nenhum crachá de uma carteira só serve para isso.
 * As consultas de lista e de exportação só aceitam um escopo (nunca uma lista de ids solta).
 */
export type WalletScope<A extends "view" | "edit" = "view" | "edit"> = {
  readonly [grantBrand]: A;
  readonly action: A;
  readonly userId: string;
  /** O lar da pessoa (null se ainda não tem lar: o escopo fica vazio) */
  readonly householdId: string | null;
  readonly walletIds: readonly string[];
};

/**
 * As carteiras da pessoa em que a ação é permitida. Com `walletId`, só aquela (se ela puder);
 * sem, todas as que ela participa (arquivadas incluídas na leitura: o histórico continua).
 */
export async function authorizeScope<A extends "view" | "edit">(
  db: PrismaClient,
  userId: string,
  action: A,
  walletId?: string | null,
): Promise<WalletScope<A>> {
  const memberships = await db.walletMember.findMany({
    where: {
      userId,
      ...(walletId
        ? { walletId: isUuid(walletId) ? walletId : "00000000-0000-0000-0000-000000000000" }
        : {}),
    },
    select: {
      role: true,
      householdId: true,
      wallet: { select: { id: true, kind: true, archivedAt: true } },
    },
  });
  const allowed = memberships.filter(
    (m) =>
      canInWallet(m.role, action, { kind: m.wallet.kind, archived: !!m.wallet.archivedAt }).allowed,
  );
  return {
    action,
    userId,
    householdId: memberships[0]?.householdId ?? null,
    walletIds: allowed.map((m) => m.wallet.id) as readonly string[],
  } as WalletScope<A>;
}
