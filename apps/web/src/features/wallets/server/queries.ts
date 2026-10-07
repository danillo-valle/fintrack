// Leituras das telas de carteira (M06). A lista é filtrada pelo vínculo da pessoa; o detalhe
// exige o crachá de "view", e cada bloco de administração pede o crachá da própria ação.
import "server-only";
import { canInHousehold, canInWallet, type WalletAction } from "@fintrack/core";
import {
  getWalletDetails,
  listAddableMembers,
  listHouseholdMembers,
  listMyWallets,
  prisma,
} from "@fintrack/db";
import {
  AccessError,
  notFoundOnDenied,
  requireHouseholdAccess,
  requireWalletAccess,
} from "@/lib/access";
import type { Session } from "@/lib/auth";

/** A lista de /carteiras e se a pessoa tem lar (sem lar, a tela convida a criar um). */
export async function getWalletsPage(session: Session) {
  const [wallets, household] = await Promise.all([
    listMyWallets(prisma, session.user.id),
    requireHouseholdAccess(session, "view").catch((error: unknown) => {
      if (error instanceof AccessError) return null;
      throw error;
    }),
  ]);
  return {
    wallets,
    hasHousehold: household !== null,
    canCreate: household !== null && canInHousehold(household.role, "create_wallet"),
  };
}

/**
 * O detalhe de /carteiras/[id]. Qualquer recusa vira 404 (notFoundOnDenied): quem não
 * participa nem fica sabendo que a carteira existe. `can` diz quais botões mostrar; o
 * servidor confere de novo em cada action (esconder botão não é segurança).
 */
export async function getWalletPage(session: Session, walletId: string) {
  const grant = await requireWalletAccess(session, walletId, "view").catch(notFoundOnDenied);
  const details = await getWalletDetails(prisma, grant);
  const state = { kind: details.kind, archived: details.archivedAt !== null };
  const can = (action: WalletAction) => canInWallet(details.myRole, action, state).allowed;

  const manage = can("manage_members");
  const addable = manage
    ? await listAddableMembers(
        prisma,
        await requireWalletAccess(session, walletId, "manage_members"),
      )
    : [];
  return {
    wallet: details,
    can: {
      rename: can("rename"),
      manageMembers: manage,
      archive: can("archive"),
      leave: can("leave"),
    },
    addable,
  };
}

/** Pessoas do lar para o formulário de nova carteira (todas menos quem cria). */
export async function getNewWalletPage(session: Session) {
  try {
    const grant = await requireHouseholdAccess(session, "create_wallet");
    const view = await requireHouseholdAccess(session, "view");
    const members = await listHouseholdMembers(prisma, view);
    return {
      household: grant.household,
      others: members.filter((m) => m.userId !== session.user.id),
    };
  } catch (error) {
    if (error instanceof AccessError) return null;
    throw error;
  }
}
