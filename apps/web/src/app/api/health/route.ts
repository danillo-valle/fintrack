// GET /api/health: o sistema está de pé? (veja src/lib/health.ts para quem consulta e por quê)
//
// Responde 200 com {"status":"ok", ...} quando o app e o banco respondem, e 503 quando o banco
// não responde. É pública (src/lib/auth/routes.ts): o monitor externo não tem login.
import { checkDatabase } from "@/lib/database-health";
import { buildHealth, healthStatusCode } from "@/lib/health";

// Sempre calculada na hora; nunca servida de cache
export const dynamic = "force-dynamic";

export async function GET() {
  const { result, latencyMs } = await checkDatabase();
  const health = buildHealth({ database: result, databaseLatencyMs: latencyMs });
  return Response.json(health, {
    status: healthStatusCode(health),
    // Nenhum proxy no caminho (Caddy, Tailscale) pode guardar uma resposta velha
    headers: { "Cache-Control": "no-store" },
  });
}
