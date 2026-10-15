// O token que o app manda ao serviço Python a cada fatura em PDF (M09.4, ADR-014).
//
// Assinado pelo plugin jwt do Better Auth com a chave Ed25519 da tabela `jwks` (a privada fica
// cifrada com o BETTER_AUTH_SECRET); o serviço confere pela chave pública de /api/auth/jwks.
// Vale 2 minutos, leva só o id da pessoa (sub) e nunca vai para o navegador: a rota /token do
// plugin está desligada (disabledPaths no auth.ts) e só o servidor chama signJWT.
import "server-only";
import { auth } from "../auth";

export async function mlServiceToken(userId: string): Promise<string> {
  const { token } = await auth.api.signJWT({
    // iat explícito: o plugin só o grava quando vem no payload, e o serviço exige
    body: { payload: { sub: userId, iat: Math.floor(Date.now() / 1000) } },
  });
  return token;
}
