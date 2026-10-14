// Textos em português da coleta bancária (M09.1): os códigos de erro da Pluggy e da
// sincronização, como aparecem no aviso do formulário e no histórico de sincronizações.
// Funções puras (sem banco): usadas no servidor e nos componentes.
import type { ProviderErrorCode } from "@fintrack/importers";

const PROVIDER_MESSAGE: Record<ProviderErrorCode | "SYNC_FAILED", string> = {
  PROVIDER_AUTH_FAILED:
    "A Pluggy recusou o Client ID e o Client Secret. Copie os dois de novo do painel da Pluggy (Aplicações).",
  PROVIDER_NOT_FOUND:
    "A Pluggy não achou esse banco com estas credenciais. Confira o Item ID no painel (Demo › Connected Items).",
  PROVIDER_RATE_LIMITED:
    "A Pluggy pediu uma pausa (muitas chamadas). Tente de novo em alguns minutos.",
  PROVIDER_UNAVAILABLE: "A Pluggy não respondeu agora. Tente de novo em alguns minutos.",
  PROVIDER_BAD_RESPONSE: "A Pluggy respondeu num formato inesperado. Tente de novo mais tarde.",
  SYNC_FAILED: "A busca parou por um erro do FinTrack. Os detalhes estão no log do servidor.",
};

/** Frase para um código de erro do provedor ou da sincronização (código desconhecido: genérico). */
export function providerErrorMessage(code: string | null | undefined): string {
  return (
    (PROVIDER_MESSAGE as Record<string, string>)[code ?? ""] ??
    "A busca não terminou. Tente de novo."
  );
}

/** Uma linha curta para o histórico ("a Pluggy recusou o Client Secret"). */
export function syncErrorShort(code: string | null | undefined): string {
  switch (code) {
    case "PROVIDER_AUTH_FAILED":
      return "a Pluggy recusou o Client Secret";
    case "PROVIDER_NOT_FOUND":
      return "um banco não foi encontrado (Item ID)";
    case "PROVIDER_RATE_LIMITED":
      return "a Pluggy pediu uma pausa";
    case "PROVIDER_UNAVAILABLE":
      return "a Pluggy não respondeu";
    case "PROVIDER_BAD_RESPONSE":
      return "resposta inesperada da Pluggy";
    case "CONNECTION_SECRET_UNREADABLE":
    case "CONNECTION_SECRET_REQUIRED":
      return "salve o Client Secret de novo";
    case "CONNECTION_KEY_MISSING":
      return "o servidor está sem a chave das conexões";
    default:
      return "erro do FinTrack (veja o log)";
  }
}
