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

/** Contas que aceitam cartão (M07): a de cartão de crédito e a de vale. */
export const CARD_ACCOUNT_KINDS = new Set(["CREDIT_CARD", "MEAL_VOUCHER"]);

/** As carteiras em que a pessoa cria conta (Nova conta, M12.3a). */
export async function getNewAccountPage(session: Session) {
  const { sections } = await getAccountsPage(session);
  return { wallets: sections.filter((s) => s.canManage).map((s) => s.wallet) };
}

/**
 * Adicionar cartão numa conta (M12.3a): só numa conta de cartão ou de vale, ativa, de uma carteira
 * de que a pessoa é dona. Qualquer outra coisa (de outra pessoa, arquivada, id inventado) = null,
 * e a tela responde 404 igual (ADR-006).
 */
export async function getCardFormPage(session: Session, accountId: string) {
  const { sections, people, me } = await getAccountsPage(session);
  for (const s of sections) {
    if (!s.canManage) continue;
    const account = s.accounts.find((a) => a.id === accountId);
    if (account && !account.archivedAt && CARD_ACCOUNT_KINDS.has(account.kind)) {
      return { wallet: s.wallet, account: { id: account.id, name: account.name }, people, me };
    }
  }
  return null;
}
