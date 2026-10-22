// O webhook do WhatsApp (M11, ADR-018). A regra toda está em features/bot/server/webhook.ts:
// assinatura sobre o corpo cru, uma vez só por mensagem, fila e 200 na hora. Roda no runtime
// Node.js, o padrão das rotas (o segmento "runtime" não combina com o cacheComponents).
import { handleWebhookGet, handleWebhookPost } from "@/features/bot/server/webhook";

export function GET(request: Request) {
  return handleWebhookGet(request);
}

export function POST(request: Request) {
  return handleWebhookPost(request);
}
