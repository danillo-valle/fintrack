// instrumentation.ts: ganchos que o Next.js chama no servidor (convenção de arquivo do Next.js).
//
//   register()        uma vez, quando o servidor sobe: registra no log que a versão X iniciou.
//                     No deploy, dá para ver no log a hora exata em que cada versão entrou.
//   onRequestError()  sempre que uma página, rota de API ou Server Action lança um erro que
//                     ninguém tratou: vira uma linha JSON com o caminho e o "digest" (o código
//                     que a tela de erro mostra), para achar o erro no log a partir da tela.
//
// O logger é importado dentro das funções (import dinâmico) para só carregar no runtime Node.js.
import type { Instrumentation } from "next";

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { logger } = await import("./lib/logger");
  logger.info({ event: "server.started", env: process.env.NODE_ENV }, "FinTrack iniciado");
}

export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { logger } = await import("./lib/logger");
  const digest =
    typeof error === "object" && error !== null && "digest" in error
      ? String(error.digest)
      : undefined;
  logger.error(
    {
      event: "request.error",
      err: error,
      digest,
      // Só o caminho, sem a query string: ela pode carregar token de redefinição de senha
      path: request.path.split("?")[0],
      method: request.method,
      routePath: context.routePath,
      routeType: context.routeType,
      // De propósito, nenhum cabeçalho: eles têm o cookie de sessão
    },
    "Erro não tratado numa requisição",
  );
};
