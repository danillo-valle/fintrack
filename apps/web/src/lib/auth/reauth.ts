// Reautenticação: antes de uma ação sensível, a pessoa prova de novo que é ela.
//
// Por quê: se alguém pegar o celular desbloqueado com o FinTrack aberto, ou roubar o cookie
// da sessão, não deve conseguir cadastrar a própria passkey, desligar o 2FA ou (nos próximos
// módulos) exportar os dados. Essas ações exigem uma prova recente: o login acabou de acontecer
// ou a pessoa confirmou a senha ou um código do app autenticador há pouco.

/** Janela em que uma prova de identidade vale para ações sensíveis. */
export const REAUTH_WINDOW_MS = 10 * 60 * 1000; // 10 minutos

/**
 * Caminhos da API do Better Auth que exigem prova recente. A checagem acontece no servidor,
 * num hook do auth.ts: não adianta chamar o endpoint direto, sem passar pela tela.
 *
 * "/change-password" não está na lista de propósito: o próprio endpoint pede a senha atual,
 * que já é a prova de identidade (e tem limite de tentativas no auth.ts).
 */
export const SENSITIVE_AUTH_PATHS = [
  "/passkey/generate-register-options", // cadastrar passkey nova
  "/passkey/delete-passkey",
  "/two-factor/disable",
  "/change-email",
  "/delete-user",
] as const;

export type ReauthSession = {
  createdAt: Date | string;
  reauthenticatedAt?: Date | string | null;
};

/** true se o login ou a última reautenticação aconteceram dentro da janela. */
export function isRecentlyAuthenticated(
  session: ReauthSession,
  now: Date = new Date(),
  windowMs: number = REAUTH_WINDOW_MS,
): boolean {
  const proofs = [session.createdAt, session.reauthenticatedAt]
    .filter((value): value is Date | string => value != null)
    .map((value) => new Date(value).getTime())
    .filter((time) => Number.isFinite(time));
  const latest = Math.max(...proofs);
  const age = now.getTime() - latest;
  // Data no futuro (relógio adiantado, valor forjado) não conta como prova
  return age >= 0 && age <= windowMs;
}

export function isSensitiveAuthPath(path: string | undefined): boolean {
  return path !== undefined && (SENSITIVE_AUTH_PATHS as readonly string[]).includes(path);
}
