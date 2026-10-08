// Ponto único de autorização do app (M06). Toda página, query e Server Action que toca uma
// carteira ou o lar passa por aqui. A decisão em si mora no pacote do banco
// (@fintrack/db: authorizeWallet / authorizeHousehold) e na regra pura (@fintrack/core:
// a matriz de papéis); este arquivo liga essa decisão à sessão do Better Auth, ao log e às
// respostas do Next.js (404 nas páginas, mensagem nas actions).
//
// Uso numa página:
//   const session = await requireUser();
//   const grant = await requireWalletAccess(session, walletId, "view").catch(notFoundOnDenied);
//
// Uso numa Server Action:
//   return runAction(async () => {
//     const session = await requireUser();
//     const grant = await requireWalletAccess(session, walletId, "rename");
//     await renameWallet(prisma, grant, name, await requestContext());
//   });
import "server-only";
import type { HouseholdAction, WalletAction } from "@fintrack/core";
import {
  authorizeAccountUse,
  authorizeHousehold,
  authorizeScope,
  authorizeTransaction,
  authorizeWallet,
  DomainError,
  prisma,
  type AccountGrant,
  type HouseholdGrant,
  type RequestContext,
  type TransactionGrant,
  type WalletGrant,
  type WalletScope,
} from "@fintrack/db";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { accessDeniedMessage, domainErrorMessage } from "./access-messages";
import type { ActionState } from "./action-state";
import type { Session } from "./auth";
import { logger } from "./logger";

export type { ActionState } from "./action-state";

/** Recusa de acesso, com o motivo que veio do @fintrack/db. */
export class AccessError extends Error {
  constructor(readonly reason: string) {
    super(reason);
    this.name = "AccessError";
  }
}

/**
 * Exige que a pessoa da sessão possa fazer `action` na carteira. Devolve o crachá que as
 * operações de @fintrack/db exigem. Recusou? Registra no log (tentativa de IDOR deixa rastro)
 * e lança AccessError.
 */
export async function requireWalletAccess<A extends WalletAction>(
  session: Session,
  walletId: string,
  action: A,
): Promise<WalletGrant<A>> {
  const access = await authorizeWallet(prisma, session.user.id, walletId, action);
  if (access.ok) return access.grant;

  // warn, não error: na maioria das vezes é um link velho; muitas seguidas indicam ataque.
  // Sem e-mail no log: o id do usuário basta para investigar.
  logger.warn(
    {
      event: "access.denied",
      resource: "wallet",
      walletId,
      action,
      reason: access.reason,
      userId: session.user.id,
    },
    "acesso negado a uma carteira",
  );
  throw new AccessError(access.reason);
}

/** O mesmo, para o lar. Sem lar ainda: AccessError("NO_HOUSEHOLD"). */
export async function requireHouseholdAccess<A extends HouseholdAction>(
  session: Session,
  action: A,
): Promise<HouseholdGrant<A>> {
  const access = await authorizeHousehold(prisma, session.user.id, action);
  if (access.ok) return access.grant;
  if (access.reason !== "NO_HOUSEHOLD") {
    logger.warn(
      {
        event: "access.denied",
        resource: "household",
        action,
        reason: access.reason,
        userId: session.user.id,
      },
      "acesso negado no lar",
    );
  }
  throw new AccessError(access.reason);
}

// ── M07: conta, lançamento e escopo ────────────────────────────────────────────

/**
 * Exige que a pessoa possa lançar na conta (pela carteira da conta ou pelo cartão adicional).
 * Conta arquivada vira mensagem de regra (ACCOUNT_ARCHIVED); fora das duas portas, 404.
 */
export async function requireAccountUse(
  session: Session,
  accountId: string,
): Promise<AccountGrant> {
  const access = await authorizeAccountUse(prisma, session.user.id, accountId);
  if (access.ok) return access.grant;
  if (access.reason === "ARCHIVED") throw new DomainError("ACCOUNT_ARCHIVED");
  logger.warn(
    {
      event: "access.denied",
      resource: "account",
      accountId,
      reason: access.reason,
      userId: session.user.id,
    },
    "acesso negado a uma conta",
  );
  throw new AccessError(access.reason);
}

/** Exige `action` no lançamento (o id vem da URL: a mesma porta de IDOR das carteiras). */
export async function requireTransactionAccess<A extends "view" | "edit">(
  session: Session,
  transactionId: string,
  action: A,
  options: { includeDeleted?: boolean } = {},
): Promise<TransactionGrant<A>> {
  const access = await authorizeTransaction(
    prisma,
    session.user.id,
    transactionId,
    action,
    options,
  );
  if (access.ok) return access.grant;
  logger.warn(
    {
      event: "access.denied",
      resource: "transaction",
      transactionId,
      action,
      reason: access.reason,
      userId: session.user.id,
    },
    "acesso negado a um lançamento",
  );
  throw new AccessError(access.reason);
}

/**
 * As carteiras em que a pessoa pode fazer `action` (para a lista que junta várias). Com
 * `walletId` (filtro da URL), só aquela, se ela puder; senão o escopo vem vazio (lista vazia,
 * sem dizer se a carteira existe).
 */
export async function requireScope<A extends "view" | "edit">(
  session: Session,
  action: A,
  walletId?: string | null,
): Promise<WalletScope<A>> {
  return authorizeScope(prisma, session.user.id, action, walletId);
}

/**
 * Para páginas: qualquer recusa vira a página 404. Inclusive "você participa mas não pode":
 * numa página de leitura, quem chega aqui por um link de outra pessoa não deve nem saber
 * que a carteira existe (OWASP: recurso de outra pessoa responde 404, não 403).
 */
export function notFoundOnDenied(error: unknown): never {
  if (error instanceof AccessError) notFound();
  throw error;
}

/**
 * Roda o corpo de uma Server Action e traduz as recusas em mensagem para a tela.
 * Erros que não são de acesso nem de regra (o banco caiu, um bug) continuam subindo:
 * o Next.js mostra a tela de erro e o instrumentation.ts registra no log.
 */
export async function runAction(fn: () => Promise<string | void>): Promise<ActionState> {
  try {
    const success = await fn();
    return { error: null, success: success ?? null };
  } catch (error) {
    if (error instanceof AccessError)
      return { error: accessDeniedMessage(error.reason), success: null };
    if (error instanceof DomainError) {
      logger.info({ event: "domain.rejected", code: error.code }, "regra do domínio recusou");
      return { error: domainErrorMessage(error.code, error.details), success: null };
    }
    throw error;
  }
}

/** IP e navegador da requisição, para a auditoria. O IP vem do Caddy (X-Forwarded-For, M05). */
export async function requestContext(): Promise<RequestContext> {
  const h = await headers();
  return {
    ip: h.get("x-forwarded-for")?.split(",")[0]?.trim() || null,
    userAgent: h.get("user-agent"),
  };
}
