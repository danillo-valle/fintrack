// instrumentation.ts: ganchos que o Next.js chama no servidor (convenção de arquivo do Next.js).
//
//   register()        uma vez, quando o servidor sobe: registra no log que a versão X iniciou e
//                     liga a fila da sincronização com o banco (M09.1, SYNC_WORKER) e a do bot
//                     do WhatsApp (M11).
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
  // M09.1: a fila da sincronização com o banco (pg-boss) sobe junto com o app. Falhar aqui não
  // derruba o site: o erro vai para o log e as telas continuam (só a busca fica parada).
  if (process.env.SYNC_WORKER !== "off") {
    const { startSyncWorker } = await import("./features/bank/server/jobs");
    startSyncWorker().catch((err: unknown) =>
      logger.error({ event: "sync.worker_failed", err }, "a fila de sincronização não subiu"),
    );
    // M11: a fila do bot do WhatsApp (sem a configuração da Meta, ela sobe e não faz nada)
    const { startBotWorker } = await import("./features/bot/server/jobs");
    startBotWorker().catch((err: unknown) =>
      logger.error({ event: "bot.worker_failed", err }, "a fila do bot não subiu"),
    );
  }
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
