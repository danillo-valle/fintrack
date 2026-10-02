"use server";

// Server Actions de autenticação. Lembrete: toda Server Action é um endpoint público (qualquer
// um pode chamá-la com um POST), por isso TODAS começam conferindo a sessão.
import { prisma } from "@fintrack/db";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { safeNextPath } from "@/lib/auth/routes";
import { requireUser } from "@/lib/auth/session";
import { reauthSchema, sessionIdSchema } from "../schemas";
import { clearFailures, recordFailure, remainingAttempts, type AttemptRule } from "./attempts";

export type ReauthState = { error: string | null };

const REAUTH_RULE: AttemptRule = { max: 5, windowMs: 15 * 60 * 1000 };

/** Confirma a identidade (senha ou código do app) e marca a sessão como reautenticada agora. */
export async function reauthenticate(_prev: ReauthState, formData: FormData): Promise<ReauthState> {
  const { session, user } = await requireUser();
  const parsed = reauthSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Confira o que foi digitado." };
  }

  const key = `fintrack:reauth:${user.id}`;
  if ((await remainingAttempts(key, REAUTH_RULE)) === 0) {
    return { error: "Muitas tentativas erradas. Por segurança, espere 15 minutos." };
  }

  const input = parsed.data;
  const requestHeaders = await headers();
  try {
    if (input.method === "password") {
      await auth.api.verifyPassword({
        body: { password: input.password },
        headers: requestHeaders,
      });
    } else {
      await auth.api.verifyTOTP({ body: { code: input.code }, headers: requestHeaders });
    }
  } catch {
    await recordFailure(key, REAUTH_RULE);
    return {
      error: input.method === "password" ? "Senha incorreta." : "Código incorreto ou expirado.",
    };
  }

  await clearFailures(key);
  await prisma.session.update({
    where: { id: session.id },
    data: { reauthenticatedAt: new Date() },
  });
  redirect(safeNextPath(input.next));
}

/**
 * Depois de reautenticar com passkey (que cria uma sessão nova), apaga a sessão anterior
 * deste mesmo aparelho, para a lista de sessões não acumular entradas repetidas.
 */
export async function finishPasskeyReauth(previousSessionId: string, next: string): Promise<void> {
  const { session, user } = await requireUser();
  const parsed = sessionIdSchema.safeParse({ sessionId: previousSessionId });
  if (parsed.success && parsed.data.sessionId !== session.id) {
    // userId no filtro: só apaga se a sessão for da própria pessoa
    await prisma.session.deleteMany({ where: { id: parsed.data.sessionId, userId: user.id } });
  }
  redirect(safeNextPath(next));
}

/** Encerra uma sessão de outro aparelho (a da lista de sessões ativas). */
export async function revokeSession(formData: FormData): Promise<void> {
  const { session, user } = await requireUser();
  const parsed = sessionIdSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return;

  const target = await prisma.session.findFirst({
    where: { id: parsed.data.sessionId, userId: user.id },
    select: { token: true, id: true },
  });
  // Sessão de outra pessoa ou inexistente: não faz nada e não diz nada (não confirma que existe)
  if (!target || target.id === session.id) return;

  await auth.api.revokeSession({ body: { token: target.token }, headers: await headers() });
  revalidatePath("/ajustes/seguranca");
}

/** Encerra todas as sessões, menos a deste aparelho. */
export async function revokeOtherSessions(): Promise<void> {
  await requireUser();
  await auth.api.revokeOtherSessions({ headers: await headers() });
  revalidatePath("/ajustes/seguranca");
}
