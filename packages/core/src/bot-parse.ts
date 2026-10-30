// O leitor das mensagens do bot (M11, ADR-018): "gastei 42,90 no mercado ontem no visa" vira um
// lançamento proposto. É DETERMINÍSTICO: regras de texto, sem LLM (a mensagem é dado, nunca
// instrução; ADR-016 e ADR-018). O que ele entende:
//
//   valor         42,90 · 42 · R$ 42,90 · 1.234,56 · 42.90 (ponto com 2 casas = centavos)
//   data          hoje · ontem · anteontem · dia 19 · 19/10 · 19/10/2026 (sem data = hoje)
//   forma         no crédito · no débito · pix · no cartão (crédito)
//   parcelas      em 3x · 3x · 3 vezes · parcelado em 3 (de 2 a 24; sempre crédito)
//   cartão        "no visa", "no master": uma palavra do apelido de um cartão
//   ambiente      "na casa", "na lia": uma palavra do nome de um ambiente
//   descrição     o que sobra ("mercado"), sem as palavras de ligação
//
// O que ele recusa: mensagem sem valor, com mais de um valor, com data no futuro, e qualquer
// sequência de 13 a 19 dígitos (parece número de cartão: a mensagem nem é guardada; ADR-018).
// A mensagem é limpa antes de tudo (cleanText, M12.4a): um invisível no meio não esconde nada.
import { decimalToCents, MAX_ABS_CENTS, type Cents } from "./money";
import { cleanText } from "./text";
import {
  addDays,
  civilDate,
  compareCivil,
  daysInMonth,
  parseCivilDate,
  type CivilDate,
} from "./dates";
import { normalizeText } from "./categorization";

/** O texto mais longo que o leitor aceita (o resto da mensagem nem é lido). */
export const BOT_MESSAGE_MAX = 300;
/** Parcelas pelo bot: as mesmas do formulário (M07.4) */
export const BOT_MIN_INSTALLMENTS = 2;
export const BOT_MAX_INSTALLMENTS = 24;
/** A descrição do lançamento: até 60 caracteres (o banco aceita 200) */
export const BOT_DESCRIPTION_MAX = 60;

export type BotParseError =
  | "EMPTY"
  | "TOO_LONG"
  | "CARD_NUMBER"
  | "NO_AMOUNT"
  | "MANY_AMOUNTS"
  | "ZERO_AMOUNT"
  | "AMOUNT_TOO_BIG"
  | "BAD_DATE"
  | "FUTURE_DATE"
  | "BAD_INSTALLMENTS"
  | "NO_DESCRIPTION";

export type BotMethodHint = "CREDIT" | "DEBIT" | "PIX";

export type BotNamed = { id: string; name: string };

export type BotParseContext = {
  today: CivilDate;
  /** Os ambientes em que a pessoa pode lançar (nome como aparece na tela) */
  wallets: readonly BotNamed[];
  /** Os cartões que a pessoa pode usar (o apelido) */
  cards: readonly BotNamed[];
};

export type BotParsedEntry = {
  cents: Cents;
  description: string;
  occurredOn: CivilDate;
  /** A forma que a mensagem disse (nula: a padrão da pessoa) */
  method: BotMethodHint | null;
  installments: number | null;
  /** Os ambientes que a mensagem citou: um = trocou; vários = ambíguo; nenhum = o padrão */
  walletIds: string[];
  /** Os cartões que a mensagem citou (mesma regra) */
  cardIds: string[];
};

/**
 * O que o leitor devolve. `NAME_ONLY` (M12.0): a mensagem tinha valor, mas a única palavra que
 * sobrava era o nome de um ambiente ou cartão ("gastei 1 no teste" com o ambiente "Teste M07");
 * a resposta diz o que foi entendido, em vez de só "faltou dizer o que foi".
 */
export type BotParseResult =
  | { ok: true; entry: BotParsedEntry }
  | { ok: false; error: BotParseError }
  | { ok: false; error: "NAME_ONLY"; walletIds: string[]; cardIds: string[] };

// ── Texto ───────────────────────────────────────────────────────────────────────

/**
 * Sequência de 13 a 19 dígitos, mesmo com espaço, ponto ou hífen no meio (cartão). Olha o texto
 * como ele aparece na tela (M12.4a): sem invisíveis, com os dígitos largos ("４１１１") e os
 * traços e espaços diferentes trocados pelos comuns.
 */
export function looksLikeCardNumber(text: string): boolean {
  const shown = cleanText(text)
    .normalize("NFKC")
    .replace(/\p{Pd}/gu, "-");
  // Junta dígitos separados só por espaço, ponto ou hífen: "4111 2222 3333 4444"
  for (const run of shown.match(/\d[\d .-]*\d/g) ?? []) {
    const digits = run.replace(/\D/g, "");
    if (digits.length >= 13 && digits.length <= 19) return true;
    // Uma sequência maior também pode esconder um cartão (dois números colados)
    if (digits.length > 19) return true;
  }
  return false;
}

/** Normaliza para comparar: minúsculas, sem acento, sem pontuação de borda. */
const word = (token: string) => normalizeText(token).replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, "");

/** As palavras de um nome ("Visa da Casa" → visa, casa), para casar com a mensagem. */
export function nameWords(name: string): string[] {
  return normalizeText(name)
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 2 && !LINKING.has(w));
}

const LINKING = new Set([
  "de",
  "da",
  "do",
  "das",
  "dos",
  "e",
  "em",
  "no",
  "na",
  "nos",
  "nas",
  "pra",
  "pro",
  "para",
  "com",
  "o",
  "a",
  "os",
  "as",
  "um",
  "uma",
  "reais",
  "real",
  "r",
  "rs",
]);

const VERBS = new Set([
  "gastei",
  "gasto",
  "paguei",
  "pago",
  "comprei",
  "compra",
  "lancar",
  "lanca",
  "foi",
  "deu",
  "custou",
]);

// "na Lia" é o ambiente; "no master" é o cartão. Quando a palavra serve aos dois ("Lia" e o
// cartão "Master da Lia"), a preposição decide: "na" e "pra" puxam o ambiente, "no" o cartão.
const WALLET_PREPOSITIONS = new Set(["na", "pra", "pro", "para", "em"]);
const CARD_PREPOSITIONS = new Set(["no", "na", "com", "pelo", "pela"]);
const NO_ONLY = new Set(["no"]);

// ── Valor ───────────────────────────────────────────────────────────────────────

/** "42,90" → 4290n; "1.234,56" → 123456n; "42.90" → 4290n; "42" → 4200n. Nulo se não é valor. */
export function parseBrazilianAmount(token: string): Cents | null {
  const t = token.replace(/^r\$/i, "");
  let decimal: string | null = null;
  if (/^\d{1,3}(\.\d{3})+(,\d{1,2})?$/.test(t)) {
    // 1.234 ou 1.234,56: ponto de milhar
    const [units, cents = ""] = t.replace(/\./g, "").split(",");
    decimal = cents ? `${units}.${cents}` : (units ?? "");
  } else if (/^\d+,\d{1,2}$/.test(t)) {
    decimal = t.replace(",", ".");
  } else if (/^\d+\.\d{2}$/.test(t)) {
    // 42.90: ponto com exatamente 2 casas = centavos (jeito comum no teclado do celular)
    decimal = t;
  } else if (/^\d+$/.test(t)) {
    decimal = t;
  }
  if (decimal === null) return null;
  return decimalToCents(decimal);
}

// ── Leitura ─────────────────────────────────────────────────────────────────────

type Token = { raw: string; norm: string; used: boolean };

function tokenize(text: string): Token[] {
  return text
    .replace(/r\$\s*/gi, "R$") // "R$ 42" e "R$42" viram um token só
    .split(/\s+/)
    .map((raw) => raw.replace(/^[(“"']+|[)”"'!?;:]+$/g, "").replace(/[.,]$/, ""))
    .filter((raw) => raw.length > 0)
    .map((raw) => ({ raw, norm: word(raw), used: false }));
}

function parseDate(tokens: Token[], today: CivilDate): CivilDate | "BAD" | "FUTURE" | null {
  let found: CivilDate | null = null;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;
    if (t.used) continue;
    if (t.norm === "hoje") {
      t.used = true;
      found = today;
    } else if (t.norm === "ontem") {
      t.used = true;
      found = addDays(today, -1);
    } else if (t.norm === "anteontem") {
      t.used = true;
      found = addDays(today, -2);
    } else if (t.norm === "dia" && /^\d{1,2}$/.test(tokens[i + 1]?.norm ?? "")) {
      const next = tokens[i + 1]!;
      t.used = true;
      next.used = true;
      const { year, month, day: todayDay } = parseCivilDate(today);
      const day = Number.parseInt(next.norm, 10);
      // "dia 19" depois de hoje = o dia 19 do mês passado
      const [y, m] =
        day > todayDay ? (month === 1 ? [year - 1, 12] : [year, month - 1]) : [year, month];
      if (day < 1 || day > daysInMonth(y, m)) return "BAD";
      found = civilDate(y, m, day);
    } else {
      const match = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{2}|\d{4}))?$/.exec(t.raw);
      if (!match) continue;
      t.used = true;
      const day = Number.parseInt(match[1]!, 10);
      const month = Number.parseInt(match[2]!, 10);
      const { year: thisYear } = parseCivilDate(today);
      let year = match[3] ? Number.parseInt(match[3], 10) : thisYear;
      if (year < 100) year += 2000;
      if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return "BAD";
      let date = civilDate(year, month, day);
      // "19/12" em janeiro, sem ano: o dezembro passado
      if (!match[3] && compareCivil(date, today) > 0) date = civilDate(year - 1, month, day);
      found = date;
    }
  }
  if (found !== null && compareCivil(found, today) > 0) return "FUTURE";
  return found;
}

function parseInstallments(tokens: Token[]): number | "BAD" | null {
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;
    if (t.used) continue;
    let count: number | null = null;
    const x = /^(\d{1,2})x$/.exec(t.norm);
    if (x) {
      count = Number.parseInt(x[1]!, 10);
      t.used = true;
      if (tokens[i - 1]?.norm === "em") tokens[i - 1]!.used = true;
    } else if (/^\d{1,2}$/.test(t.norm) && /^vez(es)?$/.test(tokens[i + 1]?.norm ?? "")) {
      count = Number.parseInt(t.norm, 10);
      t.used = true;
      tokens[i + 1]!.used = true;
      if (tokens[i - 1]?.norm === "em") tokens[i - 1]!.used = true;
    } else if (
      t.norm === "parcelado" &&
      tokens[i + 1]?.norm === "em" &&
      /^\d{1,2}$/.test(tokens[i + 2]?.norm ?? "")
    ) {
      count = Number.parseInt(tokens[i + 2]!.norm, 10);
      t.used = true;
      tokens[i + 1]!.used = true;
      tokens[i + 2]!.used = true;
      if (/^vez(es)?$/.test(tokens[i + 3]?.norm ?? "")) tokens[i + 3]!.used = true;
    }
    if (count !== null) {
      if (count < BOT_MIN_INSTALLMENTS || count > BOT_MAX_INSTALLMENTS) return "BAD";
      return count;
    }
  }
  return null;
}

function parseMethod(tokens: Token[]): BotMethodHint | null {
  let method: BotMethodHint | null = null;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;
    if (t.used) continue;
    const hit: BotMethodHint | null =
      t.norm === "credito" || t.norm === "cartao"
        ? "CREDIT"
        : t.norm === "debito"
          ? "DEBIT"
          : t.norm === "pix"
            ? "PIX"
            : null;
    if (!hit) continue;
    t.used = true;
    const before = tokens[i - 1];
    if (
      before &&
      !before.used &&
      ["no", "na", "pelo", "pela", "via", "de", "em"].includes(before.norm)
    )
      before.used = true;
    // "no cartão de crédito": a forma é uma só
    method = method && method !== hit && hit === "CREDIT" ? method : hit;
  }
  return method;
}

/** "no visa", "na casa": a palavra depois da preposição casa com um nome da lista. */
function parseNamed(
  tokens: Token[],
  items: readonly BotNamed[],
  prepositions: ReadonlySet<string>,
): string[] {
  const words = items.map((item) => ({ id: item.id, words: new Set(nameWords(item.name)) }));
  const found = new Set<string>();
  for (let i = 1; i < tokens.length; i++) {
    const t = tokens[i]!;
    const before = tokens[i - 1]!;
    if (t.used || before.used || !prepositions.has(before.norm) || t.norm.length < 2) continue;
    const hits = words.filter((w) => w.words.has(t.norm)).map((w) => w.id);
    if (hits.length === 0) continue;
    t.used = true;
    before.used = true;
    for (const id of hits) found.add(id);
  }
  return [...found];
}

function parseAmount(tokens: Token[]): Cents | "MANY" | null {
  const amounts: { token: Token; cents: Cents }[] = [];
  for (const t of tokens) {
    if (t.used) continue;
    const cents = parseBrazilianAmount(t.raw);
    if (cents !== null) amounts.push({ token: t, cents });
  }
  if (amounts.length === 0) return null;
  if (amounts.length > 1) return "MANY";
  amounts[0]!.token.used = true;
  return amounts[0]!.cents;
}

function describe(tokens: Token[]): string {
  const rest = tokens
    .filter((t) => !t.used)
    .filter((t) => !LINKING.has(t.norm) && !VERBS.has(t.norm) && t.norm !== "")
    .map((t) => t.raw);
  const text = rest.join(" ").slice(0, BOT_DESCRIPTION_MAX).trim();
  if (text === "") return "";
  return text.charAt(0).toLocaleUpperCase("pt-BR") + text.slice(1);
}

/**
 * Lê uma mensagem do bot. A ordem importa: o que já foi reconhecido (data, parcelas, forma,
 * cartão, ambiente) sai antes de procurar o valor, para "dia 19" e "3x" não virarem valor.
 */
export function parseBotMessage(text: string, context: BotParseContext): BotParseResult {
  const trimmed = cleanText(text).trim();
  if (trimmed === "") return { ok: false, error: "EMPTY" };
  if (trimmed.length > BOT_MESSAGE_MAX) return { ok: false, error: "TOO_LONG" };
  // Antes de tudo: um número de cartão nunca é lido, nem vira valor
  if (looksLikeCardNumber(trimmed)) return { ok: false, error: "CARD_NUMBER" };

  const tokens = tokenize(trimmed);
  const date = parseDate(tokens, context.today);
  if (date === "BAD") return { ok: false, error: "BAD_DATE" };
  if (date === "FUTURE") return { ok: false, error: "FUTURE_DATE" };
  const installments = parseInstallments(tokens);
  if (installments === "BAD") return { ok: false, error: "BAD_INSTALLMENTS" };
  const method = parseMethod(tokens);
  const walletIds = parseNamed(tokens, context.wallets, WALLET_PREPOSITIONS);
  const cardIds = parseNamed(tokens, context.cards, CARD_PREPOSITIONS);
  // "no Caio": o ambiente, quando a palavra não é de nenhum cartão
  if (walletIds.length === 0) walletIds.push(...parseNamed(tokens, context.wallets, NO_ONLY));
  const amount = parseAmount(tokens);
  if (amount === null) return { ok: false, error: "NO_AMOUNT" };
  if (amount === "MANY") return { ok: false, error: "MANY_AMOUNTS" };
  if (amount === 0n) return { ok: false, error: "ZERO_AMOUNT" };
  if (amount > MAX_ABS_CENTS) return { ok: false, error: "AMOUNT_TOO_BIG" };
  const description = describe(tokens);
  if (description === "" && (walletIds.length > 0 || cardIds.length > 0))
    return { ok: false, error: "NAME_ONLY", walletIds, cardIds };
  if (description === "") return { ok: false, error: "NO_DESCRIPTION" };

  return {
    ok: true,
    entry: {
      cents: amount,
      description,
      occurredOn: date ?? context.today,
      // Parcelado é sempre no crédito; um cartão citado também
      method: installments !== null || (cardIds.length > 0 && method === null) ? "CREDIT" : method,
      installments,
      walletIds,
      cardIds,
    },
  };
}
