// As chaves do bot (M11; M12.0b: para os dois canais): o HMAC de quem manda (número do WhatsApp
// ou conversa do Telegram) e o cofre do texto das mensagens (CONNECTION_SECRET_KEYS, a mesma do
// M09.1). Só existem com pelo menos um canal configurado.
import "server-only";
import { botPhoneKey, parseKeyring, type BotSecrets, type SecretKeyring } from "@fintrack/db";
import { env } from "@/lib/env";
import { telegramConfig } from "@/lib/telegram/config";
import { botConfig } from "@/lib/whatsapp/config";

let cachedKeyring: SecretKeyring | null = null;
let cachedPhoneKey: Buffer | null = null;

export function botSecrets(): BotSecrets | null {
  if ((!botConfig() && !telegramConfig()) || !env.CONNECTION_SECRET_KEYS) return null;
  cachedKeyring ??= parseKeyring(env.CONNECTION_SECRET_KEYS);
  cachedPhoneKey ??= botPhoneKey(env.BETTER_AUTH_SECRET);
  return { keyring: cachedKeyring, phoneKey: cachedPhoneKey };
}
