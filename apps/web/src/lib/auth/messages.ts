// Traduz os erros do Better Auth para mensagens em português que dizem o que fazer.
// Os códigos (INVALID_EMAIL_OR_PASSWORD...) vêm do próprio Better Auth e dos nossos hooks.

type AuthError =
  | { code?: string | undefined; status?: number | undefined; message?: string | undefined }
  | null
  | undefined;

const MESSAGES: Record<string, string> = {
  // Mesma mensagem para e-mail inexistente e senha errada: não confirma quem tem conta
  INVALID_EMAIL_OR_PASSWORD: "E-mail ou senha incorretos.",
  EMAIL_NOT_VERIFIED:
    "Confirme seu e-mail antes de entrar. Enviamos um link novo; confira a caixa de entrada.",
  INVALID_EMAIL: "Digite um e-mail válido, como nome@exemplo.com.",
  PASSWORD_TOO_SHORT: "A senha precisa ter pelo menos 8 caracteres.",
  PASSWORD_TOO_LONG: "A senha pode ter no máximo 128 caracteres.",
  PASSWORD_COMPROMISED:
    "Esta senha já apareceu em vazamentos de dados. Escolha outra, de preferência uma frase.",
  INVALID_PASSWORD: "Senha incorreta.",
  // Conta criada só pelo Google não tem senha para trocar
  CREDENTIAL_ACCOUNT_NOT_FOUND:
    "Esta conta não tem senha (ela entra pelo Google). Use o Esqueci a senha para criar uma.",
  USER_ALREADY_EXISTS: "Já existe uma conta com este e-mail. Tente entrar ou trocar a senha.",
  USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL:
    "Já existe uma conta com este e-mail. Tente entrar ou trocar a senha.",
  SIGNUP_NOT_ALLOWED: "Este e-mail não está autorizado a criar conta no FinTrack.",
  INVALID_CODE: "Código incorreto ou expirado. Confira o app autenticador e tente de novo.",
  INVALID_BACKUP_CODE: "Código de backup incorreto ou já usado.",
  ACCOUNT_TEMPORARILY_LOCKED:
    "Muitos códigos errados seguidos. Por segurança, a conta ficou bloqueada por 15 minutos.",
  INVALID_TWO_FACTOR_COOKIE: "A verificação expirou. Entre de novo com e-mail e senha.",
  INVALID_TOKEN: "Este link não é válido ou já foi usado. Peça um novo.",
  TOKEN_EXPIRED: "Este link expirou. Peça um novo.",
  REAUTH_REQUIRED: "Confirme sua identidade antes de continuar.",
  SESSION_NOT_FRESH: "Confirme sua identidade antes de continuar.",
};

const TOO_MANY = "Muitas tentativas em pouco tempo. Espere um minuto e tente de novo.";
const GENERIC = "Algo deu errado. Tente de novo em instantes.";

/** Mensagem para mostrar na tela a partir do erro devolvido pelo authClient. */
export function authErrorMessage(error: AuthError): string {
  if (!error) return GENERIC;
  if (error.status === 429) return TOO_MANY;
  if (error.code && MESSAGES[error.code]) return MESSAGES[error.code] ?? GENERIC;
  return GENERIC;
}

/** A pessoa fechou a janela da passkey (ou do aparelho) sem concluir: não é erro para mostrar. */
export function isCancelled(error: AuthError): boolean {
  return Boolean(error && "code" in error && error.code === "AUTH_CANCELLED");
}
