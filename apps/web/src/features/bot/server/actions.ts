"use server";

// Server Actions do bot (M11, ADR-018; o canal do Telegram no M12.0b, ADR-019): sessão → zod → crachá → operação (com
// auditoria). Gerar o código pede uma prova de identidade dos últimos 10 minutos (como conectar
// um banco): é o passo que dá a um número de telefone o poder de lançar em nome da pessoa.
import {
  cancelDraft,
  confirmDraft,
  createLinkCode,
  DomainError,
  prisma,
  saveBotPreference,
  setBotEnabled,
  unlinkBot,
} from "@fintrack/db";
import { revalidatePath } from "next/cache";
import { requestContext, requireHouseholdAccess, runAction, type ActionState } from "@/lib/access";
import { requireRecentAuth, requireUser } from "@/lib/auth/session";
import { financeChanged } from "@/lib/finance-cache";
import { cascadeServices } from "@/lib/ml/classifier";
import { botSecrets } from "@/lib/bot/secrets";
import { telegramConfig } from "@/lib/telegram/config";
import { botConfig } from "@/lib/whatsapp/config";
import { botChannelSchema, botDraftSchema, botPreferenceSchema, botSwitchSchema } from "../schemas";

const PAGE = "/ajustes/bot";
const REVIEW = "/lancamentos/recebidos";

function invalid(error: { issues: { message: string }[] }): ActionState {
  return { error: error.issues[0]?.message ?? "Confira o que foi escolhido.", success: null };
}

/** O estado do "Vincular meu número": o endereço da tela do código que acabou de ser gerado. */
export type LinkState = ActionState & { codeUrl: string | null };

/**
 * "Vincular meu número": gera o código (o anterior deixa de valer) e devolve o endereço da tela
 * do código. Com o React, o botão navega para lá (o modal abre por cima de Ajustes); sem ele, o
 * botão vira o link "Abrir o código". Sem prova recente, vai para /reautenticar e volta.
 */
export async function startLinkAction(_prev: LinkState, formData: FormData): Promise<LinkState> {
  const session = await requireRecentAuth(PAGE);
  const channel = botChannelSchema.safeParse(Object.fromEntries(formData));
  const secrets = botSecrets();
  const ready =
    channel.success &&
    (channel.data.canal === "TELEGRAM" ? telegramConfig() !== null : botConfig() !== null);
  if (!secrets || !ready)
    return {
      error: "O bot ainda não está configurado neste servidor.",
      success: null,
      codeUrl: null,
    };
  let codeUrl: string | null = null;
  const result = await runAction(async () => {
    const grant = await requireHouseholdAccess(session, "view");
    const created = await createLinkCode(prisma, grant, secrets.keyring, await requestContext());
    codeUrl = `${PAGE}/vincular?codigo=${created.id}${channel.data?.canal === "TELEGRAM" ? "&canal=telegram" : ""}`;
  });
  return { ...result, codeUrl };
}

export async function unlinkAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireUser();
  const parsed = botChannelSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return invalid(parsed.error);
  const channel = parsed.data.canal;
  const result = await runAction(async () => {
    const grant = await requireHouseholdAccess(session, "view");
    const removed = await unlinkBot(prisma, grant, await requestContext(), channel);
    if (!removed) return undefined;
    return channel === "TELEGRAM"
      ? "Telegram desvinculado. O bot não lê mais as mensagens dele."
      : "Número desvinculado. O bot não lê mais as mensagens dele.";
  });
  revalidatePath(PAGE);
  return result;
}

export async function setBotEnabledAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await requireUser();
  const parsed = botSwitchSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return invalid(parsed.error);
  const enabled = parsed.data.enabled === "true";
  const result = await runAction(async () => {
    const grant = await requireHouseholdAccess(session, "manage_bot");
    await setBotEnabled(prisma, grant, enabled, await requestContext());
    return enabled
      ? "Bot ligado. Ele volta a ler as mensagens dos canais vinculados."
      : "Bot desligado. As mensagens que chegarem não são lidas nem respondidas.";
  });
  revalidatePath(PAGE);
  return result;
}

export async function saveBotPreferenceAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await requireUser();
  const parsed = botPreferenceSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return invalid(parsed.error);
  const result = await runAction(async () => {
    const grant = await requireHouseholdAccess(session, "view");
    await saveBotPreference(prisma, grant, parsed.data);
    return "Padrões salvos. Valem a partir da próxima mensagem.";
  });
  revalidatePath(PAGE);
  return result;
}

/** Confirmar ou cancelar uma proposta do bot pela web (Recebidos › Do bot). */
export async function botDraftAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireUser();
  const parsed = botDraftSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return invalid(parsed.error);
  const { draftId, intent } = parsed.data;
  const result = await runAction(async () => {
    if (intent === "cancelar") {
      const cancelled = await cancelDraft(prisma, session.user.id, draftId);
      if (!cancelled) throw new DomainError("BOT_DRAFT_STALE");
      return "Proposta cancelada. Nada foi lançado.";
    }
    const confirmed = await confirmDraft(
      prisma,
      session.user.id,
      draftId,
      await requestContext(),
      cascadeServices(session.user.id),
    );
    if (!confirmed.ok)
      throw new DomainError(
        confirmed.reason === "INCOMPLETE"
          ? "BOT_DRAFT_INCOMPLETE"
          : confirmed.reason === "STALE"
            ? "BOT_DRAFT_STALE"
            : "NOT_FOUND",
      );
    return "Lançado. Está em Lançamentos.";
  });
  if (!result.error && intent === "confirmar") await financeChanged(session);
  revalidatePath(REVIEW);
  return result;
}
