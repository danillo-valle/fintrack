// Leituras da tela de contas (M07): as contas de cada carteira que a pessoa vê; quem é dono
// da carteira ganha os formulários (o servidor confere de novo em cada action).
import "server-only";
import { canInWallet, householdPeople, type HouseholdPerson } from "@fintrack/core";
import {
  householdWalletOptions,
  listHouseholdMembers,
  listMyWallets,
  listWalletAccounts,
  prisma,
} from "@fintrack/db";
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
  let people: HouseholdPerson[] = [];
  let householdId: string | null = null;
  try {
    const view = await requireHouseholdAccess(session, "view");
    householdId = view.household.id;
    // As iniciais e a cor de cada pessoa são as do "Pago por" (M13.1: quem usa cada cartão)
    people = householdPeople(await listHouseholdMembers(prisma, view));
  } catch (error) {
    if (!(error instanceof AccessError)) throw error;
  }
  return { sections, people, me: session.user.id, householdId };
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

/**
 * Editar cartão (M13.1): só um cartão ATIVO de uma conta de cartão ou de vale de uma carteira de
 * que a pessoa é dona. Qualquer outra coisa = null, e a tela responde 404 igual (ADR-006). Traz os
 * ambientes do lar com quem participa de cada um, para a tela oferecer só os do portador.
 */
export async function getEditCardPage(session: Session, accountId: string, cardId: string) {
  const { sections, people, me, householdId } = await getAccountsPage(session);
  if (!householdId) return null;
  for (const s of sections) {
    if (!s.canManage) continue;
    const account = s.accounts.find((a) => a.id === accountId);
    if (!account || account.archivedAt || !CARD_ACCOUNT_KINDS.has(account.kind)) continue;
    const card = account.cards.find((c) => c.id === cardId && !c.archivedAt);
    if (!card) return null;
    return {
      wallet: s.wallet,
      account: { id: account.id, name: account.name, holderId: account.holderId },
      card,
      people,
      me,
      wallets: await householdWalletOptions(prisma, householdId),
    };
  }
  return null;
}
