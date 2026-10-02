// Quais endereços são públicos e para onde mandar quem não tem sessão.
// Funções puras, usadas pelo proxy.ts e pelas páginas, e testadas em routes.test.ts.

/** Telas de entrada: abertas a quem não tem sessão. */
export const AUTH_PAGES = [
  "/entrar",
  "/entrar/dois-fatores",
  "/cadastro",
  "/verifique-seu-email",
  "/esqueci-a-senha",
  "/redefinir-senha",
] as const;

/** Prefixos que nunca exigem sessão: a API do Better Auth, o health check e arquivos do app. */
const PUBLIC_PREFIXES = ["/api/auth/", "/api/health", "/_next/", "/icons/"];

/** Arquivos públicos na raiz (ícones e manifesto do app instalável). */
const PUBLIC_FILES = ["/manifest.webmanifest", "/icon.svg", "/apple-icon.png", "/favicon.ico"];

export const SIGN_IN_PATH = "/entrar";
export const TWO_FACTOR_SETUP_PATH = "/configurar-2fa";
export const REAUTH_PATH = "/reautenticar";

/**
 * Cookie que o Better Auth grava entre a senha certa e o código do 2FA (vale 10 minutos).
 * Nome: o cookiePrefix do auth.ts + ".two_factor"; com HTTPS (M05), ganha o prefixo __Secure-.
 * Sem ele, a tela do código não tem o que confirmar: /entrar/dois-fatores manda para /entrar.
 */
export const TWO_FACTOR_PENDING_COOKIES = [
  "fintrack.two_factor",
  "__Secure-fintrack.two_factor",
] as const;

export function isPublicPath(pathname: string): boolean {
  return (
    (AUTH_PAGES as readonly string[]).includes(pathname) ||
    PUBLIC_FILES.includes(pathname) ||
    PUBLIC_PREFIXES.some((prefix) => pathname.startsWith(prefix))
  );
}

/**
 * Valida o destino depois do login (?next=). Só aceita caminhos internos, como "/lancamentos".
 * Sem isso, um link "/entrar?next=https://site-falso.com" levaria a pessoa para fora do app
 * logo depois de ela digitar a senha (open redirect, OWASP A01).
 */
export function safeNextPath(next: string | null | undefined, fallback = "/"): string {
  if (!next) return fallback;
  if (!next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return fallback;
  if (/[\u0000-\u001f]/.test(next)) return fallback;
  try {
    // Um caminho válido continua no mesmo endereço quando resolvido contra uma base qualquer
    const url = new URL(next, "http://fintrack.invalid");
    if (url.origin !== "http://fintrack.invalid") return fallback;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return fallback;
  }
}

/** Endereço da tela de login que, depois de entrar, volta para onde a pessoa estava. */
export function signInUrl(from: string): string {
  const next = safeNextPath(from, "/");
  return next === "/" ? SIGN_IN_PATH : `${SIGN_IN_PATH}?next=${encodeURIComponent(next)}`;
}
