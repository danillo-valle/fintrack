// Leituras da tela de contas (M07): as contas de cada carteira que a pessoa vê; quem é dono
// da carteira ganha os formulários (o servidor confere de novo em cada action).
import "server-only";
import { canInWallet } from "@fintrack/core";
import { listHouseholdMembers, listMyWallets, listWalletAccounts, prisma } from "@fintrack/db";
import { AccessError, requireHouseholdAccess, requireWalletAccess } from "@/lib/access";
import type { Session } from "@/lib/auth";

export async function getAccountsPage(session: Session) {
  const wallets = (await listMyWallets(prisma, session.user.id)).filter((w) => !w.archived);
  const sections = await Promise.all(
    wallets.map(async (w) => {
      const grant = await requireWalletAccess(session, w.id, "view");
      return {
        wallet: { id: w.id, name: w.name },
        canManage: canInWallet(w.role, "manage_accounts", { kind: w.kind, archived: false })
          .allowed,
        accounts: await listWalletAccounts(prisma, grant),
      };
    }),
  );
  let people: { userId: string; name: string }[] = [];
  try {
    const view = await requireHouseholdAccess(session, "view");
    people = (await listHouseholdMembers(prisma, view)).map((m) => ({
      userId: m.userId,
      name: m.user.name,
    }));
  } catch (error) {
    if (!(error instanceof AccessError)) throw error;
  }
  return { sections, people, me: session.user.id };
}
