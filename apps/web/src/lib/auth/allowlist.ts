// Cadastro fechado: só os e-mails desta lista conseguem criar conta.
// Funções puras (sem banco, sem rede): fáceis de testar e usadas pelo hook do Better Auth.

/** Padroniza um e-mail para comparação: sem espaços nas pontas e em minúsculas. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Lê a variável ALLOWED_EMAILS ("a@x.com, B@y.com") e devolve a lista padronizada. */
export function parseAllowedEmails(raw: string): string[] {
  const emails = raw
    .split(",")
    .map(normalizeEmail)
    .filter((email) => email.length > 0);
  for (const email of emails) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new Error(`E-mail inválido em ALLOWED_EMAILS: "${email}"`);
    }
  }
  return [...new Set(emails)];
}

/** true se o e-mail está na lista. A comparação ignora maiúsculas e espaços. */
export function isEmailAllowed(email: string, allowed: readonly string[]): boolean {
  return allowed.includes(normalizeEmail(email));
}
