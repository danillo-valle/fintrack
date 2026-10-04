// Saúde do sistema, usada pela rota /api/health.
//
// Quem consulta (M05):
//   - o deploy (deploy/bin/fintrack-deploy): só considera a versão nova no ar quando esta rota
//     responde 200 com o "version" igual ao commit que acabou de subir; senão, volta a anterior;
//   - o healthcheck do container (deploy/compose.prod.yml): o Docker marca o container como
//     "unhealthy" quando ela falha;
//   - o monitor externo (UptimeRobot): manda e-mail quando ela fica fora do ar.
//
// Por isso ela confere o banco: um app que responde mas não alcança o PostgreSQL não serve
// para nada, e precisa aparecer como falha (HTTP 503), não como "ok".
//
// Este arquivo é puro (sem I/O) e testado em health.test.ts. A consulta ao banco de verdade
// fica em database-health.ts.

/** Resultado de uma conferência (por enquanto, só o banco; o serviço Python entra no M09). */
export type CheckResult = { status: "ok" } | { status: "fail"; reason: "timeout" | "error" };

export type Health = {
  status: "ok" | "fail";
  service: "fintrack-web";
  /** Commit da imagem em produção (APP_VERSION, gravada no build); "dev" em desenvolvimento. */
  version: string;
  time: string;
  checks: { database: CheckResult & { latencyMs: number } };
};

export type HealthInput = {
  database: CheckResult;
  databaseLatencyMs: number;
  now?: Date;
  version?: string;
};

export function buildHealth({
  database,
  databaseLatencyMs,
  now = new Date(),
  version = process.env.APP_VERSION ?? "dev",
}: HealthInput): Health {
  return {
    // O sistema só está "ok" se todas as conferências estiverem ok
    status: database.status === "ok" ? "ok" : "fail",
    service: "fintrack-web",
    version,
    time: now.toISOString(),
    // Sem a mensagem de erro do banco: ela pode conter o endereço, o usuário ou o nome do banco.
    // O detalhe vai para o log (pino), que só quem opera o servidor lê.
    checks: { database: { ...database, latencyMs: Math.round(databaseLatencyMs) } },
  };
}

/** Código HTTP da resposta: 200 quando tudo está bem; 503 (serviço indisponível) quando não. */
export function healthStatusCode(health: Health): 200 | 503 {
  return health.status === "ok" ? 200 : 503;
}

/**
 * Corre uma promessa contra um relógio. Usado para a consulta ao banco não pendurar a rota:
 * o health check precisa responder rápido mesmo (e principalmente) quando o banco travou.
 */
export async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
): Promise<{ ok: true; value: T } | { ok: false; reason: "timeout" | "error"; error?: unknown }> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => resolve("timeout"), ms);
  });
  try {
    const result = await Promise.race([promise.then((value) => ({ value })), timeout]);
    if (result === "timeout") return { ok: false, reason: "timeout" };
    return { ok: true, value: result.value };
  } catch (error) {
    return { ok: false, reason: "error", error };
  } finally {
    clearTimeout(timer);
  }
}
