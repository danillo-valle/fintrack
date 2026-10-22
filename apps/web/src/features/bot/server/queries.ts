// As leituras das telas do bot (M11): Ajustes › Bot do WhatsApp, o código de vínculo e as propostas
// abertas em Recebidos. Tudo a partir da sessão: nenhuma tela recebe id de pessoa pela URL.
import "server-only";
import { botSettings, linkCodeStatus, openDrafts, prisma } from "@fintrack/db";
import { AccessError, requireHouseholdAccess } from "@/lib/access";
import type { Session } from "@/lib/auth";
import { botConfig, botSecrets } from "@/lib/whatsapp/config";

/** A tela de Ajustes. Sem lar: null (a página mostra o estado vazio). */
export async function getBotSettings(session: Session, now: Date = new Date()) {
  const grant = await requireHouseholdAccess(session, "view").catch((error: unknown) => {
    if (error instanceof AccessError) return null;
    throw error;
  });
  if (!grant) return null;
  const config = botConfig();
  const settings = await botSettings(prisma, grant, config?.phoneNumberId ?? null, now);
  return {
    ...settings,
    configured: config !== null,
    displayNumber: config?.displayNumber ?? null,
    testNumber: config?.testNumber ?? true,
  };
}

export type BotSettingsPage = NonNullable<Awaited<ReturnType<typeof getBotSettings>>>;

/** A tela do código de vínculo (esperando, vinculado ou vencido). */
export async function getLinkCode(session: Session, codeId: string, now: Date = new Date()) {
  const secrets = botSecrets();
  const config = botConfig();
  if (!secrets || !config) return null;
  const status = await linkCodeStatus(prisma, session.user.id, codeId, secrets.keyring, now);
  return { status, displayNumber: config.displayNumber, testNumber: config.testNumber };
}

export type LinkCodePage = NonNullable<Awaited<ReturnType<typeof getLinkCode>>>;

/** As propostas do bot que esperam o Confirmar desta pessoa (a seção "Do WhatsApp"). */
export async function getOpenDrafts(session: Session, now: Date = new Date()) {
  return openDrafts(prisma, session.user.id, now);
}

export type { OpenDraft } from "@fintrack/db";
