// Trilha de auditoria (OWASP A09:2025, falhas de registro e alerta). Toda mudança de
// permissão grava UMA linha em audit_log, DENTRO da mesma transação da mudança: ou as duas
// coisas acontecem, ou nenhuma. Um registro que pode faltar não serve de prova.
//
// A tabela só aceita INSERT: o gatilho audit_log_append_only (M04) recusa UPDATE, DELETE e
// TRUNCATE. Nem o próprio app consegue apagar o que aconteceu.
//
// Nunca vai para a auditoria: senha, token do convite, segredo, número de cartão (nem os 4
// finais), descrição ou valor de lançamento (M07: só contagens e ids). E-mail
// aparece mascarado (***@exemplo.com).
import type { Prisma } from "./generated/prisma/client";

/** De onde veio o pedido. O app lê do cabeçalho X-Forwarded-For que o Caddy grava (M05). */
export type RequestContext = { ip?: string | null; userAgent?: string | null };

/**
 * Os eventos registrados (M06 e M07), no formato entidade.verbo. Lista fechada (union) de
 * propósito: um erro de digitação ("wallet.renmed") vira erro de compilação.
 */
export type AuditAction =
  | "household.created"
  | "household.invite_created"
  | "household.invite_revoked"
  | "household.invite_accepted"
  | "household.member_removed"
  | "wallet.created"
  | "wallet.renamed"
  | "wallet.archived"
  | "wallet.restored"
  | "wallet.member_added"
  | "wallet.role_changed"
  | "wallet.member_removed"
  | "wallet.member_left"
  // M07: o que muda dinheiro de lugar ou tira dado do sistema. Lançar e editar NÃO vão para a
  // auditoria (seriam milhares de linhas); o lançamento guarda quem criou e quando mudou.
  | "transaction.deleted"
  | "transaction.restored"
  | "transactions.exported"
  | "recurrences.generated"
  | "recurrence.created"
  | "recurrence.archived"
  | "account.created"
  | "account.archived"
  | "card.created"
  | "card.archived"
  | "category.created"
  | "category.archived"
  | "category_rule.created"
  | "category_rule.deleted";

export type AuditEntry = {
  actorId: string | null;
  householdId: string;
  action: AuditAction;
  entity:
    | "household"
    | "household_invite"
    | "household_member"
    | "wallet"
    | "wallet_member"
    | "transaction"
    | "recurrence"
    | "financial_account"
    | "payment_card"
    | "category"
    | "category_rule";
  entityId: string;
  metadata?: Prisma.InputJsonObject;
};

const MAX_USER_AGENT = 300;

/** Grava o evento. Recebe o cliente da TRANSAÇÃO (tx), nunca o prisma solto. */
export async function writeAudit(
  tx: Prisma.TransactionClient,
  entry: AuditEntry,
  ctx: RequestContext,
): Promise<void> {
  await tx.auditLog.create({
    data: {
      actorId: entry.actorId,
      householdId: entry.householdId,
      action: entry.action,
      entity: entry.entity,
      entityId: entry.entityId,
      metadata: entry.metadata ?? {},
      ipAddress: ctx.ip ?? null,
      // O navegador manda o que quiser aqui: corta para não encher a tabela
      userAgent: ctx.userAgent ? ctx.userAgent.slice(0, MAX_USER_AGENT) : null,
    },
  });
}

/** "ana@exemplo.com" → "***@exemplo.com". A mesma regra do maskEmail do logger do app (M05). */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf("@");
  return at === -1 ? "***" : `***${email.slice(at)}`;
}
