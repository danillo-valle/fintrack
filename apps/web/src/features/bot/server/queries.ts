// As leituras das telas do bot (M11; o Telegram no M12.0b): Ajustes › Bot de lançamento, o código
// de vínculo e as propostas abertas em Recebidos. Tudo a partir da sessão: nenhuma tela recebe id
// de pessoa pela URL.
import "server-only";
import { telegramStartLink, type BotChannelKind } from "@fintrack/core";
import { botSettings, linkCodeStatus, openDrafts, prisma } from "@fintrack/db";
import { AccessError, requireHouseholdAccess } from "@/lib/access";
import type { Session } from "@/lib/auth";
import { botSecrets } from "@/lib/bot/secrets";
import { telegramConfig } from "@/lib/telegram/config";
import { botConfig } from "@/lib/whatsapp/config";

/** A tela de Ajustes. Sem lar: null (a página mostra o estado vazio). */
export async function getBotSettings(session: Session, now: Date = new Date()) {
  const grant = await requireHouseholdAccess(session, "view").catch((error: unknown) => {
    if (error instanceof AccessError) return null;
    throw error;
  });
  if (!grant) return null;
  const config = botConfig();
  const telegram = telegramConfig();
  const settings = await botSettings(prisma, grant, config?.phoneNumberId ?? null, now);
  return {
    ...settings,
    /** Algum canal pronto neste servidor (o interruptor e os padrões só fazem sentido assim) */
    configured: config !== null || telegram !== null,
    whatsappConfigured: config !== null,
    telegramConfigured: telegram !== null,
    displayNumber: config?.displayNumber ?? null,
    testNumber: config?.testNumber ?? true,
    telegramUsername: telegram?.botUsername ?? null,
  };
}

export type BotSettingsPage = NonNullable<Awaited<ReturnType<typeof getBotSettings>>>;

/**
 * A tela do código de vínculo (esperando, vinculado ou vencido). `channel` é o que a pessoa pediu
 * (as instruções: o número do WhatsApp ou "Abrir no Telegram"); o mesmo código vale nos dois.
 */
export async function getLinkCode(
  session: Session,
  codeId: string,
  channel: BotChannelKind,
  now: Date = new Date(),
) {
  const secrets = botSecrets();
  const config = botConfig();
  const telegram = telegramConfig();
  if (!secrets || (channel === "TELEGRAM" ? !telegram : !config)) return null;
  const status = await linkCodeStatus(prisma, session.user.id, codeId, secrets.keyring, now);
  return {
    status,
    channel,
    displayNumber: config?.displayNumber ?? null,
    testNumber: config?.testNumber ?? false,
    telegramUsername: telegram?.botUsername ?? null,
    telegramLink:
      telegram && status.state === "WAITING"
        ? telegramStartLink(telegram.botUsername, status.code)
        : null,
  };
}

export type LinkCodePage = NonNullable<Awaited<ReturnType<typeof getLinkCode>>>;

/** As propostas do bot que esperam o Confirmar desta pessoa (a seção "Do bot"). */
export async function getOpenDrafts(session: Session, now: Date = new Date()) {
  return openDrafts(prisma, session.user.id, now);
}

export type { OpenDraft } from "@fintrack/db";
