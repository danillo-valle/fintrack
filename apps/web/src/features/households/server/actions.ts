"use server";

// Server Actions do lar (M06). Toda action é um endpoint público (qualquer um pode chamá-la
// com um POST, sem a tela), então cada uma, nesta ordem:
//   1. confere a sessão (requireUser)
//   2. valida a entrada (zod): nada do formulário é confiável, nem o "papel" de um <select>
//   3. pega o crachá (requireHouseholdAccess): a decisão de acesso, no servidor
//   4. chama a operação do @fintrack/db, que grava a auditoria na mesma transação
import {
  acceptInvite,
  createHousehold,
  createInvite,
  prisma,
  removeHouseholdMember,
  revokeInvite,
} from "@fintrack/db";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requestContext, requireHouseholdAccess, runAction, type ActionState } from "@/lib/access";
import { requireUser } from "@/lib/auth/session";
import { formatDateTime } from "@/lib/dates";
import { householdInviteEmail } from "@/lib/email-templates";
import { env } from "@/lib/env";
import { logger, maskEmail } from "@/lib/logger";
import { sendEmail } from "@/lib/mailer";
import {
  createHouseholdSchema,
  inviteIdSchema,
  inviteSchema,
  inviteTokenSchema,
  userIdSchema,
} from "../schemas";

const HOUSEHOLD_PAGE = "/ajustes/lar";

function firstIssue(error: { issues: { message: string }[] }): ActionState {
  return { error: error.issues[0]?.message ?? "Confira o que foi digitado.", success: null };
}

/** Cria o lar da pessoa (ela vira dona) e a carteira pessoal dela. */
export async function createHouseholdAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { user } = await requireUser();
  const parsed = createHouseholdSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return firstIssue(parsed.error);

  const result = await runAction(async () => {
    await createHousehold(prisma, { user, name: parsed.data.name }, await requestContext());
  });
  if (result.error) return result;
  revalidatePath("/", "layout");
  redirect(HOUSEHOLD_PAGE);
}

/** Estado do formulário de convite: além do aviso, o link (mostrado UMA vez para copiar). */
export type InviteState = ActionState & { link: string | null };

/**
 * Convida alguém: cria o convite, manda o e-mail e devolve o link para a dona copiar
 * (WhatsApp, por exemplo). O segredo do link só existe nesta resposta.
 */
export async function createInviteAction(
  _prev: InviteState,
  formData: FormData,
): Promise<InviteState> {
  const session = await requireUser();
  const parsed = inviteSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ...firstIssue(parsed.error), link: null };

  let link: string | null = null;
  const result = await runAction(async () => {
    const grant = await requireHouseholdAccess(session, "invite");
    const { token, invite } = await createInvite(
      prisma,
      grant,
      parsed.data,
      await requestContext(),
    );
    link = `${env.BETTER_AUTH_URL}/convite/${token}`;

    // E-mail é conveniência: se falhar, o link na tela continua valendo
    try {
      await sendEmail(
        invite.email,
        householdInviteEmail(
          session.user.name,
          grant.household.name,
          link,
          formatDateTime(invite.expiresAt),
        ),
      );
    } catch (error) {
      logger.warn(
        { event: "invite.email_failed", to: maskEmail(invite.email), err: error },
        "convite sem e-mail",
      );
      return "Convite criado, mas o e-mail não saiu. Copie o link abaixo e envie você mesmo.";
    }
    return `Convite enviado para ${invite.email}. Ele vale por 72 horas e só pode ser usado uma vez.`;
  });
  revalidatePath(HOUSEHOLD_PAGE);
  return { ...result, link: result.error ? null : link };
}

/** Cancela um convite ainda aberto. */
export async function revokeInviteAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await requireUser();
  const parsed = inviteIdSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return firstIssue(parsed.error);

  const result = await runAction(async () => {
    const grant = await requireHouseholdAccess(session, "invite");
    await revokeInvite(prisma, grant, parsed.data.inviteId, await requestContext());
    return "Convite cancelado. O link deixou de funcionar.";
  });
  revalidatePath(HOUSEHOLD_PAGE);
  return result;
}

/** Tira uma pessoa do lar (ela sai das carteiras; a carteira pessoal dela é arquivada). */
export async function removeMemberAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await requireUser();
  const parsed = userIdSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return firstIssue(parsed.error);

  const result = await runAction(async () => {
    const grant = await requireHouseholdAccess(session, "remove_member");
    await removeHouseholdMember(prisma, grant, parsed.data.userId, await requestContext());
    return "Pessoa removida do lar.";
  });
  revalidatePath(HOUSEHOLD_PAGE);
  return result;
}

/** Aceita o convite do link /convite/<segredo>. Deu certo: vai para as carteiras. */
export async function acceptInviteAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { user } = await requireUser();
  const parsed = inviteTokenSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return firstIssue({ issues: [{ message: "Convite inválido." }] });

  const result = await runAction(async () => {
    await acceptInvite(prisma, { token: parsed.data.token, user }, await requestContext());
  });
  if (result.error) return result;
  revalidatePath("/", "layout");
  redirect("/carteiras");
}
