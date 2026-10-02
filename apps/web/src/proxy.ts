// proxy.ts (no Next.js 15 se chamava middleware.ts): roda antes de cada requisição.
//
// Aqui fica só a CONVENIÊNCIA de navegação: quem não tem o cookie de sessão vai direto para
// /entrar, sem carregar a página. Não é a barreira de segurança: o cookie pode ser velho ou
// falso, e o proxy não consulta o banco. A barreira são requireUser() e requireRecentAuth(),
// chamadas em toda página e action (src/lib/auth/session.ts).
import { getSessionCookie } from "better-auth/cookies";
import { NextResponse, type NextRequest } from "next/server";
import { isPublicPath, signInUrl } from "@/lib/auth/routes";

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

  // Passa o caminho atual adiante: requireUser() o usa para voltar aqui depois do login
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(PATH_HEADER, `${pathname}${search}`);
  return NextResponse.next({ request: { headers: requestHeaders } });
}

export const config = {
  // Não roda para arquivos estáticos do Next.js nem para imagens otimizadas
  matcher: ["/((?!_next/static|_next/image).*)"],
};
