// As checagens de sessão que TODA página e TODA Server Action do app chamam.
//
// O proxy.ts só confere se existe um cookie com o nome certo: é rápido e evita mostrar a página
// para quem nunca entrou, mas não confere se o cookie é válido. Quem garante é esta camada,
// que consulta o banco a cada requisição. Por isso a regra: toda página de (app) começa com
// `await requireUser()`, e toda Server Action também (uma action é um endpoint público).
import "server-only";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { auth, type Session } from "../auth";
import { isRecentlyAuthenticated } from "./reauth";
import { REAUTH_PATH, safeNextPath, signInUrl, TWO_FACTOR_SETUP_PATH } from "./routes";

/** Cabeçalho que o proxy.ts preenche com o caminho atual, para voltar a ele depois do login. */
export const PATH_HEADER = "x-fintrack-path";

/**
 * Lê a sessão do banco. O `cache` do React faz a consulta acontecer uma vez por requisição,
 * mesmo que o layout, a página e um componente chamem a função.
 */
export const getSession = cache(async (): Promise<Session | null> => {
  return auth.api.getSession({ headers: await headers() });
});

async function currentPath(): Promise<string> {
  return safeNextPath((await headers()).get(PATH_HEADER), "/");
}

/**
 * Exige sessão, mas aceita conta ainda sem 2FA. Só para a tela /configurar-2fa,
 * que é justamente onde o 2FA é ligado.
 */
export async function requireSession(): Promise<Session> {
  const session = await getSession();
  if (!session) redirect(signInUrl(await currentPath()));
  return session;
}

/**
 * Exige sessão E 2FA ligado. É a checagem padrão do app: páginas, actions e rotas de API.
 * Sem sessão → /entrar (e volta para cá depois). Sem 2FA → /configurar-2fa.
 */
export async function requireUser(): Promise<Session> {
  const session = await requireSession();
  if (!session.user.twoFactorEnabled) redirect(TWO_FACTOR_SETUP_PATH);
  return session;
}

/**
 * Exige, além do usuário, uma prova recente de identidade (login ou reautenticação nos
 * últimos 10 minutos). Use antes de ações sensíveis: exportar, excluir carteira, conectar banco.
 * `back` é para onde voltar depois de reautenticar (normalmente a página da ação).
 */
export async function requireRecentAuth(back: string): Promise<Session> {
  const session = await requireUser();
  if (!isRecentlyAuthenticated(session.session)) {
    redirect(`${REAUTH_PATH}?next=${encodeURIComponent(safeNextPath(back))}`);
  }
  return session;
}
