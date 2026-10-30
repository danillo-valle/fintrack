// A fatura do cartão em PDF (M09.4, ADR-014). Quem LÊ o PDF é o serviço Python (services/ml,
// pdfplumber); aqui ficam o cliente dele e a conversão da resposta para o StatementFile, o mesmo
// tipo do OFX: a conferência e a gravação não sabem de onde o extrato veio.
//
//   readInvoice(bytes, { baseUrl, token, password })   chama o serviço e converte
//   invoiceFromService(json)                            só a conversão (testes)
//
// O serviço devolve dinheiro como TEXTO decimal ("-199.90") e datas civis; aqui eles viram
// centavos bigint exatos (moneyFromText), sem passar por number. A senha do PDF vai num
// cabeçalho só nesta chamada e não é guardada em lugar nenhum.
import {
  fitsInColumn,
  cleanText,
  importedDescription,
  installmentFromDescription,
  isCivilDate,
  type Cents,
  type CivilDate,
  type StatementChargeKind,
} from "@fintrack/core";
import { moneyFromText } from "../exact-json";
import { normalizeBaseUrl } from "../pluggy/client";
import { stableRowIds, type StatementFile } from "../statement-file";

/** O maior PDF aceito (o serviço confere de novo). */
export const MAX_PDF_BYTES = 5 * 1024 * 1024;

/**
 * Por que a fatura foi recusada (a tela traduz):
 *   PDF_TOO_LARGE, PDF_TOO_MANY_PAGES     tamanho (5 MB) ou páginas (30)
 *   PDF_NOT_RECOGNIZED                    não é PDF, ou está quebrado
 *   PDF_PASSWORD_REQUIRED / _WRONG        tem senha / a senha não abriu
 *   PDF_NO_TEXT                           escaneado (só imagem): não lemos imagem
 *   PDF_NO_STATEMENT                      sem vencimento ou sem total: não parece fatura
 *   PDF_BAD_DATA                          uma linha com data impossível
 *   PDF_SERVICE_UNAVAILABLE               o serviço não respondeu (fora do ar, tempo)
 *   PDF_SERVICE_REJECTED                  o serviço recusou o token (configuração)
 *   PDF_SERVICE_NOT_CONFIGURED            ML_SERVICE_URL não definida
 */
export type PdfErrorCode =
  | "PDF_TOO_LARGE"
  | "PDF_TOO_MANY_PAGES"
  | "PDF_NOT_RECOGNIZED"
  | "PDF_PASSWORD_REQUIRED"
  | "PDF_PASSWORD_WRONG"
  | "PDF_NO_TEXT"
  | "PDF_NO_STATEMENT"
  | "PDF_BAD_DATA"
  | "PDF_SERVICE_UNAVAILABLE"
  | "PDF_SERVICE_REJECTED"
  | "PDF_SERVICE_NOT_CONFIGURED";

const SERVICE_CODES = new Set<string>([
  "PDF_TOO_LARGE",
  "PDF_TOO_MANY_PAGES",
  "PDF_NOT_RECOGNIZED",
  "PDF_PASSWORD_REQUIRED",
  "PDF_PASSWORD_WRONG",
  "PDF_NO_TEXT",
  "PDF_NO_STATEMENT",
  "PDF_BAD_DATA",
]);

export class PdfError extends Error {
  constructor(
    readonly code: PdfErrorCode,
    /** Detalhe SEM dado do arquivo (ex.: "HTTP 503"), para o log */
    readonly detail: string = "",
  ) {
    super(code);
    this.name = "PdfError";
  }
}

export function isPdfError(error: unknown): error is PdfError {
  return error instanceof PdfError;
}

/** É PDF pelos primeiros bytes (nunca pelo nome ou pelo tipo informado)? */
export function sniffPdf(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 5 &&
    bytes[0] === 0x25 && // %
    bytes[1] === 0x50 && // P
    bytes[2] === 0x44 && // D
    bytes[3] === 0x46 && // F
    bytes[4] === 0x2d // -
  );
}

const CHARGE_KINDS = new Set<StatementChargeKind>([
  "IOF",
  "LATE_INTEREST",
  "LATE_FEE",
  "REMUNERATIVE_INTEREST",
  "OTHER",
]);

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json =>
  typeof v === "object" && v !== null && !Array.isArray(v);
/** Todo texto lido do PDF (pelo serviço Python) passa por aqui, limpo (cleanText, M12.4a) */
const text = (v: unknown): string | null => (typeof v === "string" ? cleanText(v) : null);

function civil(v: unknown): CivilDate {
  if (typeof v !== "string" || !isCivilDate(v)) throw new PdfError("PDF_BAD_DATA", "data");
  return v;
}

function money(v: unknown): Cents {
  const cents = typeof v === "string" ? moneyFromText(v) : null;
  if (cents === null || !fitsInColumn(cents)) throw new PdfError("PDF_BAD_DATA", "valor");
  return cents;
}

/** A resposta do serviço, conferida campo a campo, no formato do FinTrack. */
export function invoiceFromService(json: unknown): StatementFile {
  if (!isObject(json) || !Array.isArray(json.transactions) || !Array.isArray(json.charges)) {
    throw new PdfError("PDF_BAD_DATA", "formato");
  }
  const lastFour = text(json.lastFour);
  const rows = json.transactions.map((raw) => {
    if (!isObject(raw)) throw new PdfError("PDF_BAD_DATA", "linha");
    return {
      occurredOn: civil(raw.occurredOn),
      description: importedDescription(text(raw.description) ?? ""),
      amount: money(raw.amount),
    };
  });
  // Linha de valor zero não é dinheiro que mexeu (e o banco recusa valor zero)
  const kept = rows.filter((r) => r.amount !== 0n);
  const ids = stableRowIds("p:", kept);
  const charges = json.charges.map((raw) => {
    if (!isObject(raw) || !CHARGE_KINDS.has(raw.kind as StatementChargeKind)) {
      throw new PdfError("PDF_BAD_DATA", "encargo");
    }
    return { kind: raw.kind as StatementChargeKind, amount: money(raw.amount) };
  });
  const total = money(json.total);
  const period = isObject(json.period)
    ? { from: civil(json.period.from), to: civil(json.period.to) }
    : null;
  return {
    format: "PDF",
    kind: "CREDIT_CARD",
    institution: text(json.institution)?.slice(0, 80) ?? null,
    bankId: null,
    lastFour: lastFour && /^\d{4}$/.test(lastFour) ? lastFour : null,
    accountType: "CREDIT_CARD",
    period,
    balance: null,
    transactions: kept.map((r, i) => ({
      externalId: ids[i]!,
      occurredOn: r.occurredOn,
      description: r.description,
      amount: r.amount,
      paymentHint: null,
      installment: installmentFromDescription(r.description),
    })),
    skipped: (typeof json.skipped === "number" ? json.skipped : 0) + (rows.length - kept.length),
    invoice: {
      dueDate: civil(json.dueDate),
      closingDate: json.closingDate === null ? null : civil(json.closingDate),
      total: total < 0n ? -total : total,
      minimum: json.minimum === null ? null : money(json.minimum),
      charges,
    },
    profile: text(json.profile)?.slice(0, 60) ?? null,
  };
}

/** O mínimo de fetch que o cliente usa (o do Node, ou um falso nos testes). */
export type PdfFetch = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: Uint8Array; signal: AbortSignal },
) => Promise<{ status: number; text(): Promise<string> }>;

/**
 * Manda o PDF ao serviço e devolve a fatura lida. `token`: o JWT curto da pessoa (o app assina
 * com o plugin jwt do Better Auth; o serviço confere pelo JWKS). `password`: só se o PDF pedir.
 */
export async function readInvoice(
  bytes: Uint8Array,
  options: {
    baseUrl: string | undefined;
    token: string;
    password?: string | null;
    fetch?: PdfFetch;
    timeoutMs?: number;
  },
): Promise<StatementFile> {
  if (!options.baseUrl) throw new PdfError("PDF_SERVICE_NOT_CONFIGURED");
  if (bytes.length > MAX_PDF_BYTES) throw new PdfError("PDF_TOO_LARGE");
  if (!sniffPdf(bytes)) throw new PdfError("PDF_NOT_RECOGNIZED");
  const base = normalizeBaseUrl(options.baseUrl, "ML_SERVICE_URL");
  const headers: Record<string, string> = {
    authorization: `Bearer ${options.token}`,
    "content-type": "application/pdf",
  };
  if (options.password) {
    headers["x-pdf-password"] = Buffer.from(options.password, "utf8").toString("base64url");
  }
  const fetchFn = options.fetch ?? (globalThis.fetch as unknown as PdfFetch);
  let response: { status: number; text(): Promise<string> };
  try {
    response = await fetchFn(`${base}/v1/faturas`, {
      method: "POST",
      headers,
      body: bytes,
      signal: AbortSignal.timeout(options.timeoutMs ?? 30_000),
    });
  } catch {
    throw new PdfError("PDF_SERVICE_UNAVAILABLE", "rede");
  }
  const body = await response.text().catch(() => "");
  if (response.status === 401) throw new PdfError("PDF_SERVICE_REJECTED", "HTTP 401");
  if (response.status === 413) throw new PdfError("PDF_TOO_LARGE");
  if (response.status === 422) {
    let code: unknown = null;
    try {
      code = (JSON.parse(body) as { code?: unknown }).code;
    } catch {
      // resposta sem JSON: trata como arquivo não reconhecido
    }
    throw new PdfError(
      typeof code === "string" && SERVICE_CODES.has(code)
        ? (code as PdfErrorCode)
        : "PDF_NOT_RECOGNIZED",
    );
  }
  if (response.status !== 200) {
    throw new PdfError("PDF_SERVICE_UNAVAILABLE", `HTTP ${response.status}`);
  }
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    throw new PdfError("PDF_BAD_DATA", "JSON");
  }
  return invoiceFromService(json);
}
