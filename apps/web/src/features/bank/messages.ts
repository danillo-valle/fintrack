// Textos em português da coleta bancária (M09.1): os códigos de erro da Pluggy e da
// sincronização, como aparecem no aviso do formulário e no histórico de sincronizações.
// Funções puras (sem banco): usadas no servidor e nos componentes.
import type { OfxErrorCode, PdfErrorCode, ProviderErrorCode } from "@fintrack/importers";

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

// ── Importar extrato (M09.3) ────────────────────────────────────────────────────

const OFX_MESSAGE: Record<OfxErrorCode | "OFX_EMPTY", string> = {
  OFX_EMPTY: "Escolha o extrato .ofx ou a fatura .pdf que você baixou do banco.",
  OFX_TOO_LARGE: "O arquivo passa de 2 MB. Baixe do banco um período menor (um mês, por exemplo).",
  OFX_NOT_RECOGNIZED:
    "Esse arquivo não é um extrato OFX. No app ou no site do banco, procure Extrato › Exportar › OFX.",
  OFX_NO_STATEMENT: "O arquivo é OFX, mas não traz extrato de conta nem fatura de cartão.",
  OFX_MULTIPLE_ACCOUNTS:
    "O arquivo traz mais de uma conta. Baixe do banco um arquivo para cada conta ou cartão.",
  OFX_NOT_BRL: "Por enquanto, só extratos em reais.",
  OFX_BAD_DATA:
    "Um lançamento do arquivo tem data ou valor que não dá para ler. Baixe o arquivo de novo do banco.",
};

/** Frase para um código do leitor de OFX (o arquivo foi recusado antes de qualquer gravação). */
export function ofxErrorMessage(code: string): string {
  return (
    (OFX_MESSAGE as Record<string, string>)[code] ?? "Não deu para ler o arquivo. Tente de novo."
  );
}

// ── Fatura em PDF (M09.4) ───────────────────────────────────────────────────────

const PDF_MESSAGE: Record<PdfErrorCode, string> = {
  PDF_TOO_LARGE: "O PDF passa de 5 MB. Baixe do banco só a fatura do mês.",
  PDF_TOO_MANY_PAGES: "O PDF tem mais de 30 páginas. Baixe do banco só a fatura do mês.",
  PDF_NOT_RECOGNIZED:
    "Não deu para abrir esse PDF. Baixe a fatura de novo do app ou do site do banco.",
  PDF_PASSWORD_REQUIRED: "Este PDF tem senha. Digite a senha para abrir.",
  PDF_PASSWORD_WRONG: "A senha não abriu o PDF. Confira e tente de novo.",
  PDF_NO_TEXT:
    "Esse PDF é uma imagem (escaneado ou foto) e não tem texto para ler. Baixe a fatura original do banco.",
  PDF_NO_STATEMENT:
    "O PDF não parece uma fatura de cartão: faltam o vencimento ou o total. Para extrato da conta, use o OFX.",
  PDF_BAD_DATA:
    "Uma linha da fatura tem data ou valor que não dá para ler. Baixe a fatura de novo do banco.",
  PDF_SERVICE_UNAVAILABLE:
    "O leitor de PDF não respondeu agora. Tente de novo em alguns minutos; o OFX continua funcionando.",
  PDF_SERVICE_REJECTED: "O leitor de PDF recusou o pedido. Os detalhes estão no log do servidor.",
  PDF_SERVICE_NOT_CONFIGURED:
    "O leitor de PDF não está ligado neste servidor. Por enquanto, importe o OFX do banco.",
};

/** Frase para um código do leitor de PDF (a fatura foi recusada antes de qualquer gravação). */
export function pdfErrorMessage(code: string): string {
  return (
    (PDF_MESSAGE as Record<string, string>)[code] ?? "Não deu para ler a fatura. Tente de novo."
  );
}
