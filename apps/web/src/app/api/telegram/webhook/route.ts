// O webhook do Telegram (M12.0b, ADR-019). A regra toda está em
// features/bot/server/telegram-webhook.ts: o segredo do cabeçalho antes do corpo, uma vez só por
// update, fila e 200 na hora. Só POST: o Telegram não usa GET.
import { handleTelegramWebhookPost } from "@/features/bot/server/telegram-webhook";

export function POST(request: Request) {
  return handleTelegramWebhookPost(request);
}
