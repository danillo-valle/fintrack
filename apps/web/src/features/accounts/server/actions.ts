"use server";

// Server Actions de contas e cartões (M07): sessão → zod → crachá "manage_accounts" da
// carteira → operação (com auditoria). O walletId do formulário não é confiável: o crachá decide.
import {
  createAccount,
  createCard,
  prisma,
  setAccountArchived,
  setCardArchived,
} from "@fintrack/db";
import { revalidatePath } from "next/cache";
import { requestContext, requireWalletAccess, runAction, type ActionState } from "@/lib/access";
import { requireUser } from "@/lib/auth/session";
import { accountSchema, archiveAccountSchema, archiveCardSchema, cardSchema } from "../schemas";

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
  revalidatePath(PAGE);
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
  revalidatePath(PAGE);
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
    await createCard(
      prisma,
      grant,
      accountId,
      { ...input, holderId: holderId || null },
      await requestContext(),
    );
    return `Cartão "${input.nickname}" cadastrado.`;
  });
  revalidatePath(PAGE);
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
  revalidatePath(PAGE);
  return result;
}
