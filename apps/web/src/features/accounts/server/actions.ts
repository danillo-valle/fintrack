"use server";

// Server Actions de contas e cartões (M07): sessão → zod → crachá "manage_accounts" da
// carteira → operação (com auditoria). O walletId do formulário não é confiável: o crachá decide.
import {
  createAccount,
  createCard,
  prisma,
  setAccountArchived,
  setCardArchived,
  setCardSharedPurchases,
} from "@fintrack/db";
import { revalidatePath } from "next/cache";
import { requestContext, requireWalletAccess, runAction, type ActionState } from "@/lib/access";
import { requireUser } from "@/lib/auth/session";
import { financeChanged } from "@/lib/finance-cache";
import {
  accountSchema,
  archiveAccountSchema,
  archiveCardSchema,
  cardSchema,
  cardSharedSchema,
} from "../schemas";

const PAGE = "/ajustes/contas";

function invalid(error: { issues: { message: string }[] }): ActionState {
  return { error: error.issues[0]?.message ?? "Confira o que foi digitado.", success: null };
}

export async function createAccountAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await requireUser();
  const parsed = accountSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return invalid(parsed.error);
  const { walletId, ...input } = parsed.data;
  const result = await runAction(async () => {
    const grant = await requireWalletAccess(session, walletId, "manage_accounts");
    await createAccount(prisma, grant, input, await requestContext());
    return `Conta "${input.name}" criada.`;
  });
  if (!result.error) await financeChanged(session);
  revalidatePath(PAGE);
  revalidatePath(`${PAGE}/[accountId]`, "page");
  return result;
}

export async function setAccountArchivedAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await requireUser();
  const parsed = archiveAccountSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return invalid(parsed.error);
  const archived = parsed.data.archived === "true";
  const result = await runAction(async () => {
    const grant = await requireWalletAccess(session, parsed.data.walletId, "manage_accounts");
    await setAccountArchived(
      prisma,
      grant,
      parsed.data.accountId,
      archived,
      await requestContext(),
    );
    return archived ? "Conta arquivada." : "Conta desarquivada.";
  });
  if (!result.error) await financeChanged(session);
  revalidatePath(PAGE);
  revalidatePath(`${PAGE}/[accountId]`, "page");
  return result;
}

export async function createCardAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await requireUser();
  const parsed = cardSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return invalid(parsed.error);
  const { walletId, accountId, holderId, ...input } = parsed.data;
  const result = await runAction(async () => {
    const grant = await requireWalletAccess(session, walletId, "manage_accounts");
    const card = await createCard(
      prisma,
      grant,
      accountId,
      { ...input, holderId: holderId || null },
      await requestContext(),
    );
    // M09.2: recebidos do banco com este final já estavam esperando o cadastro
    const moved =
      card.rerouted === 0
        ? ""
        : card.rerouted === 1
          ? " 1 recebido do banco foi para ele."
          : ` ${card.rerouted} recebidos do banco foram para ele.`;
    return `Cartão "${input.nickname}" cadastrado.${moved}`;
  });
  if (!result.error) await financeChanged(session);
  revalidatePath(PAGE);
  revalidatePath(`${PAGE}/[accountId]`, "page");
  return result;
}

export async function setCardArchivedAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await requireUser();
  const parsed = archiveCardSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return invalid(parsed.error);
  const archived = parsed.data.archived === "true";
  const result = await runAction(async () => {
    const grant = await requireWalletAccess(session, parsed.data.walletId, "manage_accounts");
    await setCardArchived(prisma, grant, parsed.data.cardId, archived, await requestContext());
    return archived ? "Cartão arquivado." : "Cartão desarquivado.";
  });
  if (!result.error) await financeChanged(session);
  revalidatePath(PAGE);
  revalidatePath(`${PAGE}/[accountId]`, "page");
  return result;
}

/** Marca ou desmarca um cartão como de compras conjuntas (M07.4). Só quem gere as contas. */
export async function setCardSharedPurchasesAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await requireUser();
  const parsed = cardSharedSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return invalid(parsed.error);
  const shared = parsed.data.sharedPurchases === "true";
  const result = await runAction(async () => {
    const grant = await requireWalletAccess(session, parsed.data.walletId, "manage_accounts");
    await setCardSharedPurchases(prisma, grant, parsed.data.cardId, shared, await requestContext());
    return shared
      ? "Cartão marcado como de compras conjuntas: as compras dele aparecem como Compartilhado."
      : "Cartão desmarcado: as compras dele voltam a aparecer como do portador.";
  });
  if (!result.error) await financeChanged(session);
  revalidatePath(PAGE);
  revalidatePath(`${PAGE}/[accountId]`, "page");
  revalidatePath("/lancamentos");
  return result;
}
