// Exportação CSV (M07): o arquivo que abre direto no Excel em português.
//
// Três cuidados:
//   1. Excel brasileiro: separador ";" e vírgula decimal ("-1234,56"), com BOM UTF-8 no início
//      (sem ele, o Excel mostra "SÃ£o" no lugar de "São").
//   2. Aspas: célula com ";", aspas ou quebra de linha vai entre aspas, com as aspas dobradas.
//   3. Injeção de fórmula (OWASP, "CSV Injection"): uma descrição que comece com "=", "+", "-",
//      "@", tab ou CR vira FÓRMULA quando o arquivo é aberto. Um lançamento importado com a
//      descrição "=HYPERLINK(...)" executaria ao abrir. Toda célula de TEXTO que comece assim
//      ganha um apóstrofo na frente. Números e datas que o próprio FinTrack escreve não passam
//      por isso (senão "-12,34" viraria texto).
import { centsToDecimal, type Cents } from "./money";

export const CSV_SEPARATOR = ";";
export const CSV_BOM = "﻿";

/** Uma célula: texto livre (vindo de pessoa ou de banco) ou valor que o FinTrack formatou. */
export type CsvCell = { text: string | null } | { raw: string };

const FORMULA_START = /^[=+\-@\t\r]/;

function escapeCell(value: string): string {
  return /[;"\r\n]/.test(value) || /^\s|\s$/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** Célula de texto, com a proteção contra fórmula. */
export function csvText(value: string | null): string {
  if (value === null || value === "") return "";
  return escapeCell(FORMULA_START.test(value) ? `'${value}` : value);
}

/** Dinheiro no formato do Excel em português: -123456n → "-1234,56" (sem milhar). */
export function csvMoney(cents: Cents): string {
  return centsToDecimal(cents).replace(".", ",");
}

/** Monta o arquivo: BOM, cabeçalho, linhas, CRLF (o que o Excel espera). */
export function toCsv(header: readonly string[], rows: Iterable<readonly CsvCell[]>): string {
  const lines = [header.map((h) => csvText(h)).join(CSV_SEPARATOR)];
  for (const row of rows) {
    lines.push(
      row
        .map((cell) => ("raw" in cell ? escapeCell(cell.raw) : csvText(cell.text)))
        .join(CSV_SEPARATOR),
    );
  }
  return CSV_BOM + lines.join("\r\n") + "\r\n";
}
