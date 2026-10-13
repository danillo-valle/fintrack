// O adaptador do Meu Pluggy com o endereço da API do ambiente (PLUGGY_API_URL: a Pluggy de
// verdade em produção; a de mentira no dev, no CI e nos testes E2E).
import "server-only";
import { PluggyProvider, type PluggyCredentials } from "@fintrack/importers";
import { prisma, providerForConnection } from "@fintrack/db";
import { env } from "@/lib/env";
import { connectionKeyring } from "./keyring";

/** Para testar credenciais recém-digitadas (antes de gravar). */
export function pluggyWith(credentials: PluggyCredentials): PluggyProvider {
  return new PluggyProvider({ credentials, baseUrl: env.PLUGGY_API_URL });
}

/** O adaptador da conexão gravada (decifra o segredo só agora). Sem credenciais: null. */
export function pluggyFor(connectionId: string): Promise<PluggyProvider | null> {
  return providerForConnection(prisma, connectionId, connectionKeyring(), {
    baseUrl: env.PLUGGY_API_URL,
  });
}
