// A configuração do bot do Telegram (M12.0b, ADR-019), lida das variáveis de ambiente. O Telegram
// só existe com o token do @BotFather, o segredo do webhook, o @ do bot e a chave que cifra o
// texto das mensagens (CONNECTION_SECRET_KEYS). Faltou alguma: null, e o webhook responde como
// rota inexistente.
import "server-only";
import { env } from "@/lib/env";

export type TelegramConfig = {
  token: string;
  webhookSecret: string;
  botUsername: string;
  apiUrl: string;
};

export function telegramConfig(): TelegramConfig | null {
  const { TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET, TELEGRAM_BOT_USERNAME } = env;
  if (
    !TELEGRAM_BOT_TOKEN ||
    !TELEGRAM_WEBHOOK_SECRET ||
    !TELEGRAM_BOT_USERNAME ||
    !env.CONNECTION_SECRET_KEYS
  )
    return null;
  return {
    token: TELEGRAM_BOT_TOKEN,
    webhookSecret: TELEGRAM_WEBHOOK_SECRET,
    botUsername: TELEGRAM_BOT_USERNAME,
    apiUrl: env.TELEGRAM_API_URL,
  };
}
