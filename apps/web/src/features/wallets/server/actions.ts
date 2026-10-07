"use server";

// Server Actions das carteiras (M06). Mesma receita das do lar: sessão → zod → crachá →
// operação (com auditoria). O walletId vem do formulário e NÃO é confiável: quem decide se a
// pessoa pode mexer nele é requireWalletAccess, consultando o vínculo dela no banco.
import {
  addWalletMember,
  createSharedWallet,
  leaveWallet,
  prisma,
  removeWalletMember,
  renameWallet,
  setWalletArchived,
  setWalletMemberRole,
} from "@fintrack/db";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  requestContext,
  requireHouseholdAccess,
  requireWalletAccess,
  runAction,
  type ActionState,
} from "@/lib/access";
import { requireUser } from "@/lib/auth/session";
import {
  archiveSchema,
  memberRoleSchema,
  memberSchema,
  parseCreateWalletForm,
  renameWalletSchema,
  walletIdSchema,
} from "../schemas";

function invalid(error: { issues: { message: string }[] }): ActionState {
  return { error: error.issues[0]?.message ?? "Confira o que foi digitado.", success: null };
}

const walletPage = (id: string) => `/carteiras/${id}`;

/** Cria uma carteira compartilhada; quem cria é dono. Deu certo: abre a carteira nova. */
export async function createWalletAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await requireUser();
  const parsed = parseCreateWalletForm(formData);
  if (!parsed.success) return invalid(parsed.error);

  let walletId = "";
  const result = await runAction(async () => {
    const grant = await requireHouseholdAccess(session, "create_wallet");
    const wallet = await createSharedWallet(prisma, grant, parsed.data, await requestContext());
    walletId = wallet.id;
  });
  if (result.error) return result;
  revalidatePath("/carteiras");
  redirect(walletPage(walletId));
}

export async function renameWalletAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await requireUser();
  const parsed = renameWalletSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return invalid(parsed.error);

  const result = await runAction(async () => {
    const grant = await requireWalletAccess(session, parsed.data.walletId, "rename");
    await renameWallet(prisma, grant, parsed.data.name, await requestContext());
    return "Nome salvo.";
  });
  revalidatePath(walletPage(parsed.data.walletId));
  return result;
}

export async function setArchivedAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await requireUser();
  const parsed = archiveSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return invalid(parsed.error);
  const archived = parsed.data.archived === "true";

  const result = await runAction(async () => {
    const grant = await requireWalletAccess(session, parsed.data.walletId, "archive");
    await setWalletArchived(prisma, grant, archived, await requestContext());
    return archived ? "Carteira arquivada." : "Carteira desarquivada.";
  });
  revalidatePath(walletPage(parsed.data.walletId));
  revalidatePath("/carteiras");
  return result;
}

export async function addMemberAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await requireUser();
  const parsed = memberRoleSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return invalid(parsed.error);
  const { walletId, userId, role } = parsed.data;

  const result = await runAction(async () => {
    const grant = await requireWalletAccess(session, walletId, "manage_members");
    await addWalletMember(prisma, grant, { userId, role }, await requestContext());
    return "Pessoa adicionada.";
  });
  revalidatePath(walletPage(walletId));
  return result;
}

export async function setRoleAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireUser();
  const parsed = memberRoleSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return invalid(parsed.error);
  const { walletId, userId, role } = parsed.data;

  const result = await runAction(async () => {
    const grant = await requireWalletAccess(session, walletId, "manage_members");
    await setWalletMemberRole(prisma, grant, { userId, role }, await requestContext());
    return "Papel atualizado.";
  });
  revalidatePath(walletPage(walletId));
  return result;
}

export async function removeMemberFromWalletAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await requireUser();
  const parsed = memberSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return invalid(parsed.error);
  const { walletId, userId } = parsed.data;

  const result = await runAction(async () => {
    const grant = await requireWalletAccess(session, walletId, "manage_members");
    await removeWalletMember(prisma, grant, userId, await requestContext());
    return "Pessoa removida da carteira.";
  });
  revalidatePath(walletPage(walletId));
  return result;
}

/** A própria pessoa sai da carteira compartilhada. Deu certo: volta para a lista. */
export async function leaveWalletAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await requireUser();
  const parsed = walletIdSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return invalid(parsed.error);

  const result = await runAction(async () => {
    const grant = await requireWalletAccess(session, parsed.data.walletId, "leave");
    await leaveWallet(prisma, grant, await requestContext());
  });
  if (result.error) return result;
  revalidatePath("/carteiras");
  redirect("/carteiras");
}
