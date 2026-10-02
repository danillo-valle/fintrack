// Leituras do banco para a tela de segurança. Ficam em server/ (a regra do ESLint permite o
// Prisma aqui) e sempre filtram pelo userId da sessão: ninguém vê o que é de outra pessoa.
import { prisma } from "@fintrack/db";
import type { PasskeyItem } from "../ui/passkey-manager";
import type { SessionItem } from "../ui/session-list";

/** Sessões ainda válidas da pessoa, da mais recente para a mais antiga. Nunca devolve o token. */
export async function listMySessions(userId: string): Promise<SessionItem[]> {
  return prisma.session.findMany({
    where: { userId, expiresAt: { gt: new Date() } },
    select: { id: true, userAgent: true, ipAddress: true, createdAt: true, updatedAt: true },
    orderBy: { updatedAt: "desc" },
  });
}

/** Passkeys da pessoa (só o necessário para a lista: nada da chave pública). */
export async function listMyPasskeys(userId: string): Promise<PasskeyItem[]> {
  const rows = await prisma.passkey.findMany({
    where: { userId },
    select: { id: true, name: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });
  return rows.map((row) => ({ ...row, createdAt: row.createdAt?.toISOString() ?? null }));
}
