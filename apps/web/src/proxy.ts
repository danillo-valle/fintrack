// proxy.ts (no Next.js 15 se chamava middleware.ts): roda antes de cada requisição.
//
// Faz duas coisas:
//
// 1. CONVENIÊNCIA de navegação: quem não tem o cookie de sessão vai direto para /entrar, sem
//    carregar a página. Não é a barreira de segurança: o cookie pode ser velho ou falso, e o
//    proxy não consulta o banco. A barreira são requireUser() e requireRecentAuth(), chamadas
//    em toda página e action (src/lib/auth/session.ts).
//
// 2. CSP com nonce (M05): sorteia um número novo a cada requisição e manda a política
//    Content-Security-Policy com ele. O Next.js lê a política da requisição, acha o nonce e o
//    coloca em todos os <script> que ele mesmo gera. Um script injetado por um atacante não tem
//    o nonce, e o navegador se recusa a rodá-lo. Detalhes em src/lib/security-headers.ts.
import { getSessionCookie } from "better-auth/cookies";
import { NextResponse, type NextRequest } from "next/server";
import { isPublicPath, signInUrl } from "@/lib/auth/routes";
import { buildCsp, createNonce, NONCE_HEADER } from "@/lib/security-headers";

// Mesmo nome que o session.ts lê. Repetido aqui porque o session.ts importa código de servidor.
const PATH_HEADER = "x-fintrack-path";

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  if (!isPublicPath(pathname)) {
    // Confere só se o cookie existe (sem ir ao banco). O prefixo é o mesmo do auth.ts.
    const hasSessionCookie = getSessionCookie(request, { cookiePrefix: "fintrack" }) !== null;
    if (!hasSessionCookie) {
      return NextResponse.redirect(new URL(signInUrl(`${pathname}${search}`), request.url));
    }
  }

  const nonce = createNonce();
  const csp = buildCsp({
    nonce,
    dev: process.env.NODE_ENV === "development",
    // BETTER_AUTH_URL é o endereço público do app; em produção começa com https://
    https: (process.env.BETTER_AUTH_URL ?? "").startsWith("https://"),
  });

  const requestHeaders = new Headers(request.headers);
  // Passa o caminho atual adiante: requireUser() o usa para voltar aqui depois do login
  requestHeaders.set(PATH_HEADER, `${pathname}${search}`);
  // O Next.js procura o nonce na CSP da REQUISIÇÃO; o layout lê o x-nonce
  requestHeaders.set(NONCE_HEADER, nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  // E a CSP da RESPOSTA é a que o navegador obedece
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  // Não roda para arquivos estáticos do Next.js nem para imagens otimizadas
  matcher: ["/((?!_next/static|_next/image).*)"],
};
