// Trava de segurança do seed: em qual banco ele pode gravar?
//
// O seed APAGA a "Família Exemplo" (id fixo) antes de gravar de novo. Ele não toca nas contas
// de verdade, mas mesmo assim só deve rodar onde alguém pediu de propósito:
//
//   - banco local (localhost): o seu desenvolvimento. Liberado, como no M04.
//   - qualquer outro banco (o "db" do container de produção, no M05): só com SEED_TARGET_HOST
//     igual ao host do DATABASE_URL. É uma confirmação explícita: quem roda precisa escrever o
//     nome do banco que vai receber os dados, e um DATABASE_URL apontado para o lugar errado
//     (por engano de .env) não passa.
//
// Até o M12 a produção só tem dados sintéticos (roteiro); no M12 o seed sai da produção.
// Função pura: testada em guard.test.ts.

const LOCAL_HOSTS = ["localhost", "127.0.0.1", "::1", "[::1]"];

export type SeedGuardResult = { ok: true; host: string } | { ok: false; reason: string };

export function checkSeedTarget(env: {
  DATABASE_URL?: string | undefined;
  SEED_TARGET_HOST?: string | undefined;
}): SeedGuardResult {
  let host = "";
  try {
    host = new URL(env.DATABASE_URL ?? "").hostname;
  } catch {
    return { ok: false, reason: "DATABASE_URL ausente ou inválida." };
  }
  if (!host) return { ok: false, reason: "DATABASE_URL sem host." };

  if (LOCAL_HOSTS.includes(host)) return { ok: true, host };

  if (env.SEED_TARGET_HOST && env.SEED_TARGET_HOST === host) return { ok: true, host };

  return {
    ok: false,
    reason:
      `O seed só roda num banco local (localhost). DATABASE_URL aponta para "${host}". ` +
      `Para gravar dados sintéticos nesse banco de propósito, rode com SEED_TARGET_HOST=${host}.`,
  };
}
