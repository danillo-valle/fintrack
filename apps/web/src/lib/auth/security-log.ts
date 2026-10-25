// O registro dos eventos de segurança do login (M12.1, OWASP A09:2025).
//
// Toda chamada do navegador ao Better Auth passa pela rota /api/auth/[...all]. Ela entrega a
// resposta a logAuthResponse, que grava UMA linha quando a resposta conta uma tentativa que não
// passou:
//
//   auth.failed           senha, código do 2FA, código de backup, passkey ou link de troca de
//                         senha recusados (quem tenta adivinhar aparece aqui)
//   auth.rate_limited     o limite de tentativas barrou (429)
//   auth.origin_rejected  pedido de outra origem ou sem origem (CSRF)
//
// A linha leva o caminho, o status, o código do Better Auth (INVALID_EMAIL_OR_PASSWORD...) e o
// IP de quem pediu (o Caddy repassa um só, o da Cloudflare). Nunca o corpo do pedido: nem
// e-mail, nem senha, nem código. A contagem das últimas 24 h aparece no fintrack-status.
import type { Logger } from "pino";
import { logger as appLogger } from "@/lib/logger";

export type AuthSecurityEvent = "auth.failed" | "auth.rate_limited" | "auth.origin_rejected";

/** Os endpoints em que uma recusa é uma tentativa de entrar (ou de provar identidade). */
const CREDENTIAL_PATHS = new Set([
  "/sign-in/email",
  "/two-factor/verify-totp",
  "/two-factor/verify-backup-code",
  "/passkey/verify-authentication",
  "/change-password",
  "/reset-password",
]);

const ORIGIN_CODES = new Set(["INVALID_ORIGIN", "MISSING_OR_NULL_ORIGIN"]);

/** Qual evento uma resposta do Better Auth representa (ou nenhum). Função pura. */
export function authSecurityEvent(
  path: string,
  status: number,
  code: string | null,
): AuthSecurityEvent | null {
  if (status === 429) return "auth.rate_limited";
  if (status === 403 && code !== null && ORIGIN_CODES.has(code)) return "auth.origin_rejected";
  if (status >= 400 && status < 500 && CREDENTIAL_PATHS.has(path)) return "auth.failed";
  return null;
}

/** O caminho do Better Auth ("/sign-in/email") a partir do endereço do pedido. */
export function authPath(url: string): string {
  const { pathname } = new URL(url);
  return pathname.startsWith("/api/auth/") ? pathname.slice("/api/auth".length) : pathname;
}

/** O código do erro do Better Auth, só se tiver a forma de um código (nada de texto livre). */
async function errorCode(response: Response): Promise<string | null> {
  try {
    const body = (await response.clone().json()) as { code?: unknown };
    return typeof body.code === "string" && /^[A-Z][A-Z0-9_]{0,63}$/.test(body.code)
      ? body.code
      : null;
  } catch {
    return null; // corpo vazio ou que não é JSON (o 429 do limite, por exemplo)
  }
}

/** Grava o evento de segurança da resposta, se houver, e devolve a resposta intacta. */
export async function logAuthResponse(
  request: Request,
  response: Response,
  log: Pick<Logger, "warn"> = appLogger,
): Promise<Response> {
  if (response.status < 400) return response;
  const path = authPath(request.url);
  const code = await errorCode(response);
  const event = authSecurityEvent(path, response.status, code);
  if (event) {
    const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null;
    log.warn({ event, path, status: response.status, code, ip }, "tentativa recusada no login");
  }
  return response;
}
