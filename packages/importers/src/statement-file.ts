// O extrato que a pessoa manda em arquivo (M09.3 OFX, M09.4 PDF da fatura), já lido e no formato
// do FinTrack. Os leitores (ofx/, pdf/) devolvem este tipo; a conferência e a gravação
// (@fintrack/db, file-imports.ts) só conhecem este tipo, nunca o formato do arquivo.
import { createHash } from "node:crypto";
import type { Cents, CivilDate, StatementChargeKind, StatementKind } from "@fintrack/core";
import type { ProviderTransaction } from "./provider";

/** Um lançamento do arquivo, nos campos que o importador grava. */
export type FileTransaction = Pick<
  ProviderTransaction,
  "externalId" | "occurredOn" | "description" | "amount" | "paymentHint" | "installment"
>;

/** A fatura que o PDF traz (o OFX não traz): vencimento, total, mínimo e encargos. */
export type FileInvoice = {
  dueDate: CivilDate;
  closingDate: CivilDate | null;
  /** Total a pagar (positivo) */
  total: Cents;
  minimum: Cents | null;
  charges: { kind: StatementChargeKind; amount: Cents }[];
};

export type StatementFile = {
  format: "OFX" | "PDF";
  kind: StatementKind;
  /** Nome do banco, quando o arquivo traz */
  institution: string | null;
  /** Código do banco (BANKID do OFX), só no extrato de conta */
  bankId: string | null;
  /** Os 4 últimos dígitos da conta ou do cartão */
  lastFour: string | null;
  accountType: "CHECKING" | "SAVINGS" | "CREDIT_CARD";
  /** O período (do arquivo; sem ele, a primeira e a última data) */
  period: { from: CivilDate; to: CivilDate } | null;
  /** Saldo no fim do período (OFX) */
  balance: { amount: Cents; on: CivilDate } | null;
  transactions: FileTransaction[];
  /** Linhas que não viram lançamento (valor zero, pagamento da fatura anterior) */
  skipped: number;
  /** A fatura (só PDF) */
  invoice: FileInvoice | null;
  /** O perfil que leu o PDF ("Banco Exemplo", "genérico"); nulo no OFX */
  profile: string | null;
};

/**
 * Um id estável para a linha que não tem id da fonte: hash das partes (data, valor, descrição…)
 * e da ordem entre as linhas iguais. Ler o mesmo arquivo de novo dá os mesmos ids.
 */
export function stableRowId(parts: readonly string[]): string {
  return createHash("sha256").update(parts.join("\u001f")).digest("hex").slice(0, 32);
}

/** Os ids de um lote de linhas sem id: `prefixo` + hash, com a ordem das linhas iguais. */
export function stableRowIds(
  prefix: string,
  rows: readonly { occurredOn: CivilDate; amount: Cents; description: string }[],
): string[] {
  const seen = new Map<string, number>();
  return rows.map((row) => {
    const key = [row.occurredOn, String(row.amount), row.description].join("|");
    const ordinal = seen.get(key) ?? 0;
    seen.set(key, ordinal + 1);
    return `${prefix}${stableRowId([key, String(ordinal)])}`;
  });
}

/** A impressão digital do arquivo (SHA-256): o que fica guardado no lugar do arquivo. */
export function fileFingerprint(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}
