// A configuração do bot do WhatsApp (M11, ADR-018), lida das variáveis de ambiente. O bot só
// existe com as quatro do painel da Meta e a chave que cifra o texto das mensagens
// (CONNECTION_SECRET_KEYS, a mesma do M09.1). Faltou alguma: null, e o webhook responde como
// rota inexistente. As chaves do bot (para os dois canais) ficam em lib/bot/secrets.ts.
import "server-only";
import { env } from "@/lib/env";

export type BotConfig = {
  appSecret: string;
  accessToken: string;
  verifyToken: string;
  phoneNumberId: string;
  apiUrl: string;
  displayNumber: string | null;
  testNumber: boolean;
};

export function botConfig(): BotConfig | null {
  const {
    WHATSAPP_APP_SECRET,
    WHATSAPP_ACCESS_TOKEN,
    WHATSAPP_VERIFY_TOKEN,
    WHATSAPP_PHONE_NUMBER_ID,
  } = env;
  if (
    !WHATSAPP_APP_SECRET ||
    !WHATSAPP_ACCESS_TOKEN ||
    !WHATSAPP_VERIFY_TOKEN ||
    !WHATSAPP_PHONE_NUMBER_ID ||
    !env.CONNECTION_SECRET_KEYS
  )
    return null;
  return {
    appSecret: WHATSAPP_APP_SECRET,
    accessToken: WHATSAPP_ACCESS_TOKEN,
    verifyToken: WHATSAPP_VERIFY_TOKEN,
    phoneNumberId: WHATSAPP_PHONE_NUMBER_ID,
    apiUrl: env.WHATSAPP_API_URL,
    displayNumber: env.WHATSAPP_DISPLAY_NUMBER ?? null,
    testNumber: env.WHATSAPP_TEST_NUMBER === "on",
  };
}
