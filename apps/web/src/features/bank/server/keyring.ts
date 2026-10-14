// A chave que cifra o Client Secret do Meu Pluggy (M09.1, ADR-011), lida de CONNECTION_SECRET_KEYS.
// Sem a variável, as telas de conexão explicam que o servidor ainda não está pronto
// (DomainError CONNECTION_KEY_MISSING) em vez de quebrar.
import "server-only";
import { DomainError, parseKeyring, type SecretKeyring } from "@fintrack/db";
import { env } from "@/lib/env";

let cached: SecretKeyring | null = null;

export function connectionKeyring(): SecretKeyring {
  if (cached) return cached;
  if (!env.CONNECTION_SECRET_KEYS) throw new DomainError("CONNECTION_KEY_MISSING");
  cached = parseKeyring(env.CONNECTION_SECRET_KEYS);
  return cached;
}

/** O servidor tem a chave? (a tela de Conexões mostra um aviso quando não tem) */
export function keyringReady(): boolean {
  return Boolean(env.CONNECTION_SECRET_KEYS);
}
