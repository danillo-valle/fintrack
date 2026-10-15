// O arquivo OFX (M09.3, ADR-013): o extrato que o banco deixa baixar, da conta corrente ou do
// cartão. Duas versões no mundo:
//
//   OFX 1.x  cabeçalho "OFXHEADER:100" e corpo em SGML (as folhas não fecham: <TRNAMT>-12.50),
//            quase sempre em windows-1252 (latin-1). É o que os bancos brasileiros mandam.
//   OFX 2.x  XML de verdade ("<?xml …?><?OFX …?>"), com tudo fechado, em UTF-8.
//
// Um leitor só, linear, para as duas: cada tag vira um nó; folha é a tag com texto; uma tag que
// fecha volta até a sua abertura (no SGML, as folhas abertas no caminho ficam para trás).
// Nada de eval, DTD ou entidade externa: o texto do arquivo nunca vira código nem URL.
//
// Saem os tipos do FinTrack (dinheiro bigint exato, data civil, só os 4 últimos dígitos). O
// número inteiro da conta ou do cartão (ACCTID) é lido aqui e DESCARTADO aqui: nada além do final
// sai desta função, nem em erro.
import { createHash } from "node:crypto";
import {
  fitsInColumn,
  importedDescription,
  installmentFromDescription,
  isCivilDate,
  lastFourOf,
  paymentHintFromText,
  type Cents,
  type CivilDate,
  type StatementKind,
} from "@fintrack/core";
import { moneyFromText } from "../exact-json";
import type { ProviderTransaction } from "../provider";

/** O maior arquivo aceito: um ano de extrato de conta movimentada fica bem abaixo disso. */
export const MAX_OFX_BYTES = 2 * 1024 * 1024;

/**
 * Por que o arquivo foi recusado (a tela traduz o código):
 *   OFX_TOO_LARGE          mais de 2 MB
 *   OFX_NOT_RECOGNIZED     não é um OFX (outro tipo de arquivo, ou binário)
 *   OFX_NO_STATEMENT       é OFX, mas sem extrato de conta ou de cartão
 *   OFX_MULTIPLE_ACCOUNTS  mais de uma conta no mesmo arquivo (um arquivo por conta)
 *   OFX_NOT_BRL            extrato em outra moeda
 *   OFX_BAD_DATA           um lançamento com data ou valor ilegível
 */
export type OfxErrorCode =
  | "OFX_TOO_LARGE"
  | "OFX_NOT_RECOGNIZED"
  | "OFX_NO_STATEMENT"
  | "OFX_MULTIPLE_ACCOUNTS"
  | "OFX_NOT_BRL"
  | "OFX_BAD_DATA";

export class OfxError extends Error {
  constructor(
    readonly code: OfxErrorCode,
    /** Detalhe SEM dado do arquivo (ex.: "lançamento 12: data"), para o log */
    readonly detail: string = "",
  ) {
    super(code);
    this.name = "OfxError";
  }
}

export function isOfxError(error: unknown): error is OfxError {
  return error instanceof OfxError;
}

/** Um lançamento do arquivo, nos campos que o importador grava. */
export type OfxTransaction = Pick<
  ProviderTransaction,
  "externalId" | "occurredOn" | "description" | "amount" | "paymentHint" | "installment"
>;

export type OfxStatement = {
  version: 1 | 2;
  kind: StatementKind;
  /** Nome do banco (FI/ORG), quando o arquivo traz */
  institution: string | null;
  /** Código do banco (BANKID), só no extrato de conta */
  bankId: string | null;
  /** Os 4 últimos dígitos da conta ou do cartão */
  lastFour: string | null;
  accountType: "CHECKING" | "SAVINGS" | "CREDIT_CARD";
  /** O período do extrato (DTSTART/DTEND; sem eles, a primeira e a última data) */
  period: { from: CivilDate; to: CivilDate } | null;
  /** Saldo (LEDGERBAL) e o dia dele */
  balance: { amount: Cents; on: CivilDate } | null;
  transactions: OfxTransaction[];
  /** Linhas que não viram lançamento: valor zero e o pagamento da fatura no extrato do cartão */
  skipped: number;
};

// ── Bytes → texto ───────────────────────────────────────────────────────────────

const ascii = (bytes: Uint8Array, length: number) =>
  String.fromCharCode(...bytes.subarray(0, Math.min(length, bytes.length)));

/** OFX 1, OFX 2 ou nada, olhando só o começo do arquivo (nunca o nome nem o tipo informado). */
export function sniffOfx(bytes: Uint8Array): 1 | 2 | null {
  let start = 0;
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) start = 3; // BOM do UTF-8
  const head = bytes.subarray(start, start + 4096);
  if (head.includes(0)) return null; // binário (zip, PDF comprimido, imagem…)
  const text = ascii(head, head.length).trimStart();
  if (/^OFXHEADER\s*:\s*\d+/.test(text)) return 1;
  if (/^<\?xml[^>]*\?>\s*<\?OFX\b/i.test(text)) return 2;
  if (/^<OFX>/i.test(text)) return 1; // alguns bancos mandam o corpo SGML sem o cabeçalho
  return null;
}

function decode(bytes: Uint8Array, version: 1 | 2): string {
  const head = ascii(bytes, 1024);
  const utf8 =
    version === 2
      ? !/encoding\s*=\s*["'](?!utf-?8)/i.test(head)
      : /ENCODING\s*:\s*UTF-?8/i.test(head);
  if (utf8) {
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      // Diz UTF-8 mas não é: cai para o latin-1, como os bancos realmente gravam
    }
  }
  return new TextDecoder("windows-1252").decode(bytes);
}

// ── Texto → árvore ──────────────────────────────────────────────────────────────

type OfxNode = { name: string; value: string | null; children: OfxNode[] };

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

function unescape(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, ref: string) => {
    if (ref.startsWith("#x") || ref.startsWith("#X"))
      return String.fromCodePoint(Number.parseInt(ref.slice(2), 16));
    if (ref.startsWith("#")) return String.fromCodePoint(Number.parseInt(ref.slice(1), 10));
    return ENTITIES[ref.toLowerCase()] ?? whole;
  });
}

function parseTree(text: string): OfxNode {
  const start = text.search(/<OFX>/i);
  if (start < 0) throw new OfxError("OFX_NOT_RECOGNIZED", "sem <OFX>");
  const body = text.slice(start).replace(/<!--[\s\S]*?-->/g, "");
  const root: OfxNode = { name: "#root", value: null, children: [] };
  const stack: OfxNode[] = [root];
  const tag = /<(\/?)([A-Za-z0-9._]+)>([^<]*)/g;
  for (let m = tag.exec(body); m; m = tag.exec(body)) {
    const closing = m[1] === "/";
    const name = m[2]!.toUpperCase();
    const raw = m[3]!;
    if (closing) {
      // Fecha até a abertura. Não achou: é o fechamento de uma folha (XML) e não muda nada
      const at = stack.findLastIndex((node) => node.name === name);
      if (at > 0) stack.length = at;
      continue;
    }
    const value = raw.trim();
    const node: OfxNode = { name, value: value === "" ? null : unescape(value), children: [] };
    stack.at(-1)!.children.push(node);
    if (node.value === null) stack.push(node); // agregado: os próximos são filhos dele
  }
  return root;
}

const child = (node: OfxNode | undefined, name: string) =>
  node?.children.find((c) => c.name === name);
const text = (node: OfxNode | undefined, name: string) => child(node, name)?.value ?? null;

function findAll(node: OfxNode, names: readonly string[], found: OfxNode[] = []): OfxNode[] {
  for (const c of node.children) {
    if (names.includes(c.name)) found.push(c);
    else findAll(c, names, found);
  }
  return found;
}

// ── Valores ─────────────────────────────────────────────────────────────────────

/** "20261003120000[-3:BRT]" → "2026-10-03": o dia escrito, sem converter fuso (como o banco mostra). */
function civilOf(value: string | null): CivilDate | null {
  const digits = /^(\d{4})(\d{2})(\d{2})/.exec(value?.trim() ?? "");
  if (!digits) return null;
  const date = `${digits[1]}-${digits[2]}-${digits[3]}`;
  return isCivilDate(date) ? date : null;
}

/** "-312.48", "-312,48" ou "1.234,56" → centavos exatos (sem passar por number). */
function amountOf(value: string | null): Cents | null {
  if (!value) return null;
  let raw = value.trim().replace(/^\+/, "");
  const comma = raw.lastIndexOf(",");
  const dot = raw.lastIndexOf(".");
  if (comma > dot) raw = raw.replace(/\./g, "").replace(",", ".");
  else if (comma >= 0) raw = raw.replace(/,/g, "");
  return moneyFromText(raw);
}

function fallbackId(parts: readonly string[]): string {
  return createHash("sha256").update(parts.join("\u001f")).digest("hex").slice(0, 32);
}

// ── O extrato ───────────────────────────────────────────────────────────────────

/**
 * Lê um arquivo OFX. Recusa (OfxError) o que não for um extrato de UMA conta, em reais.
 *
 * `externalId` de cada lançamento: o FITID do banco. Sem FITID, ou com o mesmo FITID em mais de
 * uma linha (há banco que repete), um hash estável de FITID + data + valor + descrição + a ordem
 * entre as linhas iguais: importar o mesmo arquivo de novo dá os mesmos ids.
 */
export function parseOfx(bytes: Uint8Array): OfxStatement {
  if (bytes.length > MAX_OFX_BYTES) throw new OfxError("OFX_TOO_LARGE");
  const version = sniffOfx(bytes);
  if (!version) throw new OfxError("OFX_NOT_RECOGNIZED");
  const root = parseTree(decode(bytes, version));

  const statements = findAll(root, ["STMTRS", "CCSTMTRS"]);
  if (statements.length === 0) throw new OfxError("OFX_NO_STATEMENT");
  if (statements.length > 1) throw new OfxError("OFX_MULTIPLE_ACCOUNTS");
  const statement = statements[0]!;
  const kind: StatementKind = statement.name === "CCSTMTRS" ? "CREDIT_CARD" : "BANK";

  const currency = (text(statement, "CURDEF") ?? "BRL").toUpperCase();
  if (currency !== "BRL") throw new OfxError("OFX_NOT_BRL");

  const from = child(statement, kind === "BANK" ? "BANKACCTFROM" : "CCACCTFROM");
  const lastFour = lastFourOf(text(from, "ACCTID")); // o número inteiro morre aqui
  const type = text(from, "ACCTTYPE")?.toUpperCase();
  const accountType =
    kind === "CREDIT_CARD" ? "CREDIT_CARD" : type === "SAVINGS" ? "SAVINGS" : "CHECKING";
  const org = text(child(findAll(root, ["SONRS"])[0], "FI"), "ORG");

  const list = child(statement, "BANKTRANLIST");
  const rows = (list?.children ?? []).filter((c) => c.name === "STMTTRN");
  const transactions: OfxTransaction[] = [];
  let skipped = 0;

  const fitidCount = new Map<string, number>();
  for (const row of rows) {
    const fitid = text(row, "FITID");
    if (fitid) fitidCount.set(fitid, (fitidCount.get(fitid) ?? 0) + 1);
  }
  const seen = new Map<string, number>();

  rows.forEach((row, index) => {
    const occurredOn = civilOf(text(row, "DTPOSTED") ?? text(row, "DTUSER"));
    if (!occurredOn) throw new OfxError("OFX_BAD_DATA", `lançamento ${index + 1}: data`);
    const amount = amountOf(text(row, "TRNAMT"));
    if (amount === null || !fitsInColumn(amount))
      throw new OfxError("OFX_BAD_DATA", `lançamento ${index + 1}: valor`);
    const rawDescription = [text(row, "MEMO"), text(row, "NAME")].find((t) => t) ?? "";
    const description = importedDescription(rawDescription);
    const trnType = text(row, "TRNTYPE");

    // Linha de valor zero (aviso do banco, tarifa isenta): não é dinheiro que mexeu
    if (amount === 0n) {
      skipped += 1;
      return;
    }
    // O pagamento da fatura no extrato do cartão: é a conta pagando o cartão (já está no
    // extrato da conta), não uma compra. Fica de fora, como na busca do Meu Pluggy.
    if (kind === "CREDIT_CARD" && amount > 0n && /\bPAGAMENTO\b|\bPGTO\b/i.test(description)) {
      skipped += 1;
      return;
    }

    const fitid = text(row, "FITID");
    let externalId: string;
    if (fitid && fitidCount.get(fitid) === 1 && fitid.length <= 200) {
      externalId = fitid;
    } else {
      const key = [fitid ?? "", occurredOn, String(amount), description].join("|");
      const ordinal = seen.get(key) ?? 0;
      seen.set(key, ordinal + 1);
      externalId = `h:${fallbackId([key, String(ordinal)])}`;
    }

    transactions.push({
      externalId,
      occurredOn,
      description,
      amount,
      paymentHint: kind === "CREDIT_CARD" ? null : paymentHintFromText(trnType, description),
      installment: installmentFromDescription(description),
    });
  });

  const start = civilOf(text(list, "DTSTART"));
  const end = civilOf(text(list, "DTEND"));
  const dates = transactions.map((t) => t.occurredOn).sort();
  const period =
    start && end
      ? { from: start, to: end }
      : dates.length > 0
        ? { from: dates[0]!, to: dates.at(-1)! }
        : null;

  const ledger = child(statement, "LEDGERBAL");
  const balanceAmount = amountOf(text(ledger, "BALAMT"));
  const balanceOn = civilOf(text(ledger, "DTASOF"));

  return {
    version,
    kind,
    institution: org ? importedDescription(org).slice(0, 80) : null,
    bankId: kind === "BANK" ? (text(from, "BANKID")?.slice(0, 20) ?? null) : null,
    lastFour,
    accountType,
    period,
    balance: balanceAmount !== null && balanceOn ? { amount: balanceAmount, on: balanceOn } : null,
    transactions,
    skipped,
  };
}

/** A impressão digital do arquivo (SHA-256): o que fica guardado no lugar do arquivo. */
export function fileFingerprint(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}
