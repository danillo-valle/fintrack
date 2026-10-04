// Confere se o PostgreSQL responde, para a rota /api/health.
//
// Fica em src/lib porque importa @fintrack/db (o ESLint só deixa o banco ser usado em src/lib e
// em features/*/server). É a única consulta do app que não passa pela checagem de acesso: ela
// não lê dado nenhum, só pergunta "você está aí?" (SELECT 1).
import "server-only";
import { prisma } from "@fintrack/db";
import { type CheckResult, withTimeout } from "./health";
import { logger } from "./logger";

/** Quanto esperar pelo banco antes de declarar falha. O monitor e o deploy esperam ~5 s. */
const DATABASE_TIMEOUT_MS = 2000;

export async function checkDatabase(): Promise<{ result: CheckResult; latencyMs: number }> {
  const started = performance.now();
  const outcome = await withTimeout(prisma.$queryRaw`SELECT 1`, DATABASE_TIMEOUT_MS);
  const latencyMs = performance.now() - started;

  if (outcome.ok) return { result: { status: "ok" }, latencyMs };

  // O motivo detalhado vai para o log do servidor, nunca para a resposta pública
  logger.error(
    { event: "health.database_failed", reason: outcome.reason, err: outcome.error },
    "Banco de dados não respondeu ao health check",
  );
  return { result: { status: "fail", reason: outcome.reason }, latencyMs };
}
