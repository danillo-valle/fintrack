// Todos os endpoints do Better Auth (/api/auth/sign-in/email, /api/auth/two-factor/...)
// passam por esta única rota. [...all] captura qualquer caminho depois de /api/auth/.
//
// M12.1 (OWASP A09): a resposta passa por logAuthResponse, que registra senha ou código
// recusados, o limite de tentativas (429) e pedido de outra origem. É aqui, e não num plugin do
// Better Auth, porque o 429 do limite sai antes de qualquer gancho dele.
import { toNextJsHandler } from "better-auth/next-js";
import { auth } from "@/lib/auth";
import { logAuthResponse } from "@/lib/auth/security-log";

const handler = toNextJsHandler(auth);

export async function GET(request: Request) {
  return logAuthResponse(request, await handler.GET(request));
}

export async function POST(request: Request) {
  return logAuthResponse(request, await handler.POST(request));
}
