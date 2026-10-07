// Leituras da tela do lar (M06). Cada bloco só é lido se o papel permitir: o membro comum
// não recebe a lista de convites nem a trilha de auditoria (nem escondida no HTML).
import "server-only";
import { canInHousehold } from "@fintrack/core";
import {
  authorizeHousehold,
  findInviteByToken,
  listHouseholdActivity,
  listHouseholdMembers,
  listOpenInvites,
  prisma,
} from "@fintrack/db";
import { AccessError, requireHouseholdAccess } from "@/lib/access";
import type { Session } from "@/lib/auth";

/** Tudo que a página /ajustes/lar mostra, ou null quando a pessoa ainda não tem lar. */
export async function getHouseholdPage(session: Session) {
  try {
    const grant = await requireHouseholdAccess(session, "view");
    const canManage = canInHousehold(grant.role, "invite");
    const [members, invites, activity] = await Promise.all([
      listHouseholdMembers(prisma, grant),
      canManage
        ? listOpenInvites(prisma, await requireHouseholdAccess(session, "invite"))
        : Promise.resolve([]),
      canInHousehold(grant.role, "view_activity")
        ? listHouseholdActivity(prisma, await requireHouseholdAccess(session, "view_activity"))
        : Promise.resolve([]),
    ]);
    const now = Date.now();
    return {
      household: grant.household,
      myRole: grant.role,
      canManage,
      members,
      // "expirou" é calculado aqui, no servidor, e não no componente (render precisa ser puro)
      invites: invites.map((invite) => ({ ...invite, expired: invite.expiresAt.getTime() <= now })),
      activity,
    };
  } catch (error) {
    if (error instanceof AccessError && error.reason === "NO_HOUSEHOLD") return null;
    throw error;
  }
}

/** O que a tela do convite mostra (sem revelar nada a quem não tem o link certo). */
export async function getInvitePreview(token: string) {
  return findInviteByToken(prisma, token);
}

/** A pessoa já tem lar? (Para a tela de convite avisar antes de ela tentar aceitar.) */
export async function hasHousehold(userId: string): Promise<boolean> {
  // Pela mesma porta de sempre: nenhuma tela consulta as tabelas do lar direto
  return (await authorizeHousehold(prisma, userId, "view")).ok;
}
