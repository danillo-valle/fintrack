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
  updateAccount,
  updateCard,
} from "@fintrack/db";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requestContext, requireWalletAccess, runAction, type ActionState } from "@/lib/access";
import { requireUser } from "@/lib/auth/session";
import { financeChanged } from "@/lib/finance-cache";
import {
  accountSchema,
  archiveAccountSchema,
  archiveCardSchema,
  cardSchema,
  cardSharedSchema,
  editAccountSchema,
  editCardSchema,
} from "../schemas";

const PAGE = "/ajustes/contas";

function invalid(error: { issues: { message: string }[] }): ActionState {
  return { error: error.issues[0]?.message ?? "Confira o que foi digitado.", success: null };
}

/**
 * Nova conta (M07; em modal desde o M12.3a, prancha J-NovaConta). Deu certo: volta para a lista
 * com ?criada=<id>, que mostra o aviso no topo e marca a conta (o aviso no fim do formulário
 * passava despercebido e a mesma conta era criada de novo).
 */
export async function createAccountAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await requireUser();
  const parsed = accountSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return invalid(parsed.error);
  const { walletId, ...input } = parsed.data;
  let created: string | null = null;
  const result = await runAction(async () => {
    const grant = await requireWalletAccess(session, walletId, "manage_accounts");
    created = (await createAccount(prisma, grant, input, await requestContext())).id;
  });
  if (result.error || !created) return result;
  await financeChanged(session);
  revalidatePath(PAGE);
  revalidatePath(`${PAGE}/[accountId]`, "page");
  redirect(`${PAGE}?criada=${created}`);
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

/**
 * Adicionar cartão (M07; em modal desde o M12.3a, prancha J-AdicionarCartao). Deu certo: volta
 * para a lista (?cartao=<id>) ou para a página da conta (?movidos=N), conforme de onde veio. Os
 * recebidos do banco com este final que esperavam o cadastro (M09.2) vão para ele.
 */
export async function createCardAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await requireUser();
  const parsed = cardSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return invalid(parsed.error);
  const { walletId, accountId, holderId, volta, ...input } = parsed.data;
  let created: { id: string; rerouted: number } | null = null;
  const result = await runAction(async () => {
    const grant = await requireWalletAccess(session, walletId, "manage_accounts");
    const card = await createCard(
      prisma,
      grant,
      accountId,
      { ...input, holderId: holderId || null },
      await requestContext(),
    );
    created = { id: card.id, rerouted: card.rerouted };
  });
  if (result.error || !created) return result;
  const { id, rerouted } = created;
  await financeChanged(session);
  revalidatePath(PAGE);
  revalidatePath(`${PAGE}/[accountId]`, "page");
  redirect(
    volta === "conta"
      ? `${PAGE}/${accountId}?movidos=${rerouted}`
      : `${PAGE}?cartao=${id}&movidos=${rerouted}`,
  );
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

/**
 * Editar cartão (M13.1, em modal, prancha L-EditarCartao). Deu certo: volta para a lista
 * (?editado=<id>&movidos=N) ou para a página da conta, com o aviso no topo. O "Pago por" é
 * calculado, então mudar o portador ou a conjunta vale também para as compras antigas.
 */
export async function updateCardAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await requireUser();
  const parsed = editCardSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return invalid(parsed.error);
  const { walletId, cardId, volta, importWalletId, ...input } = parsed.data;
  let updated: { accountId: string; moved: number } | null = null;
  const result = await runAction(async () => {
    const grant = await requireWalletAccess(session, walletId, "manage_accounts");
    // A conta é a do cartão, lida no servidor (o formulário não manda conta)
    updated = await updateCard(
      prisma,
      grant,
      cardId,
      { ...input, importWalletId: importWalletId === "padrao" ? null : importWalletId },
      await requestContext(),
    );
  });
  if (result.error || !updated) return result;
  const { accountId, moved } = updated;
  await financeChanged(session);
  revalidatePath(PAGE);
  revalidatePath(`${PAGE}/[accountId]`, "page");
  revalidatePath("/lancamentos");
  redirect(
    volta === "conta"
      ? `${PAGE}/${accountId}?editado=${cardId}&movidos=${moved}`
      : `${PAGE}?editado=${cardId}&movidos=${moved}`,
  );
}

/**
 * Editar conta (M13.2, prancha M-EditarConta): o apelido e, numa conta manual, o tipo. Volta para
 * Contas e cartões com o aviso no topo e a conta marcada.
 */
export async function updateAccountAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await requireUser();
  const parsed = editAccountSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return invalid(parsed.error);
  const { walletId, accountId, ...input } = parsed.data;
  const result = await runAction(async () => {
    const grant = await requireWalletAccess(session, walletId, "manage_accounts");
    await updateAccount(prisma, grant, accountId, input, await requestContext());
  });
  if (result.error) return result;
  revalidatePath(PAGE);
  revalidatePath(`${PAGE}/[accountId]`, "page");
  revalidatePath("/lancamentos");
  revalidatePath("/");
  redirect(`${PAGE}?editada=${accountId}`);
}
