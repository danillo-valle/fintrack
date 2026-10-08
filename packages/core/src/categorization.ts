// Categorização de lançamentos (M07): as regras puras da cascata "texto → categoria".
//
// A cascata pergunta, em ordem, a quem sabe responder; a primeira resposta vence:
//
//   1. REGRA     "a descrição contém 'mercado' → Mercado" (CategoryRule, criada pela pessoa,
//                inclusive a partir de uma correção: "sempre categorizar assim?")
//   2. HISTÓRICO a categoria que o lar mais usou para o mesmo comerciante (merchantKey)
//   …  M09: a categoria que a Pluggy devolve; M10: o classificador (scikit-learn) e, por último,
//      um LLM numa fila assíncrona. Cada camada nova é um CategorySuggester a mais na lista:
//      nada aqui muda (ADR-007).
//
// Tudo que está neste arquivo é puro: recebe textos e listas, devolve a sugestão. Quem busca
// as regras e o histórico no banco (e só nas carteiras que a pessoa pode ver) é o @fintrack/db.

// ── Texto ───────────────────────────────────────────────────────────────────────

/**
 * Texto para comparar: sem acento, minúsculo, sem pontuação nas pontas, espaços simples.
 *   normalizeText("  PADARIA São João  ") → "padaria sao joao"
 * As regras do banco guardam o padrão já assim (CHECK: pattern = lower(pattern)).
 */
export function normalizeText(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // tira os acentos que o NFD separou da letra
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * O texto que as regras comparam: normalizado e com a pontuação trocada por espaço.
 *   matchText("Netflix.com*Assinatura") → "netflix com assinatura"
 * Assim a regra "netflix com" (sugerida a partir de uma correção) combina com a descrição
 * original, e a pessoa não precisa adivinhar onde o banco pôs ponto ou asterisco.
 */
export function matchText(text: string): string {
  return normalizeText(text)
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Palavras que não identificam o comerciante
const STOPWORDS = new Set(["de", "da", "do", "das", "dos", "e", "em", "com", "para", "no", "na"]);
// Marcas que bancos e maquininhas põem na descrição: compra, pagamento, parcela...
const NOISE = new Set([
  "compra",
  "pagamento",
  "pag",
  "pgto",
  "parc",
  "parcela",
  "cartao",
  "deb",
  "cred",
]);
const MAX_KEY_TOKENS = 3;

/**
 * A "chave do comerciante": o que sobra da descrição depois de tirar números, datas, parcelas
 * e ruído de banco. Duas compras no mesmo lugar ganham a mesma chave.
 *   merchantKey("PADARIA SÃO JOÃO 02/10")      → "padaria sao joao"
 *   merchantKey("Netflix.com parc 03/12")       → "netflix"
 *   merchantKey("MERCADO BOM PRECO LTDA 4432")  → "mercado bom preco"
 * Devolve "" quando não sobra nada (descrição só com números): sem chave, sem sugestão.
 */
export function merchantKey(description: string): string {
  const tokens = matchText(description) // pontuação, *, /, . viram espaço
    .split(" ")
    .filter((t) => t.length >= 2 && /[a-z]/.test(t)) // sem números soltos e letras soltas
    .filter((t) => !STOPWORDS.has(t) && !NOISE.has(t))
    .filter((t) => !/\d{3,}/.test(t)); // códigos como "loja123456"
  return tokens.slice(0, MAX_KEY_TOKENS).join(" ");
}

// ── Regras ──────────────────────────────────────────────────────────────────────

export type RuleMatch = "CONTAINS" | "STARTS_WITH" | "EQUALS";
export const RULE_MATCHES: readonly RuleMatch[] = ["CONTAINS", "STARTS_WITH", "EQUALS"];

export const RULE_PATTERN_MIN = 2;
export const RULE_PATTERN_MAX = 100;

export type CategoryRuleLike = {
  id: string;
  categoryId: string;
  pattern: string;
  match: RuleMatch;
  priority: number;
};

/** O padrão de uma regra como o banco guarda (normalizado). null se ficar curto ou longo demais. */
export function normalizeRulePattern(input: string): string | null {
  const pattern = normalizeText(input);
  return pattern.length >= RULE_PATTERN_MIN && pattern.length <= RULE_PATTERN_MAX ? pattern : null;
}

/** A regra combina com a descrição? Os dois lados passam por matchText antes de comparar. */
export function ruleMatches(
  rule: Pick<CategoryRuleLike, "pattern" | "match">,
  description: string,
) {
  const text = matchText(description);
  const pattern = matchText(rule.pattern);
  if (pattern === "") return false;
  switch (rule.match) {
    case "EQUALS":
      return text === pattern;
    case "STARTS_WITH":
      return text.startsWith(pattern);
    case "CONTAINS":
      return text.includes(pattern);
  }
}

/**
 * A regra que vale para a descrição: menor prioridade primeiro; empate, o padrão mais longo
 * (mais específico: "posto shell" vence "posto"); empate de novo, o id (ordem estável).
 */
export function firstMatchingRule<R extends CategoryRuleLike>(
  rules: readonly R[],
  description: string,
): R | null {
  const ordered = [...rules].sort(
    (a, b) =>
      a.priority - b.priority ||
      b.pattern.length - a.pattern.length ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
  return ordered.find((rule) => ruleMatches(rule, description)) ?? null;
}

/**
 * O padrão sugerido quando a pessoa corrige uma categoria e marca "sempre categorizar assim":
 * o primeiro trecho de palavras da descrição (pula o ruído do começo, como "compra cartao",
 * e para no primeiro número ou ruído depois dele), com até 3 palavras.
 *   "COMPRA CARTAO - POSTO SHELL 123456" → "posto shell"
 *   "Padaria da Esquina 02/10"           → "padaria da esquina"
 * Por construção, o trecho está DENTRO de matchText(descrição): a regra "contém" sempre
 * combina com a descrição que a criou (há um teste de propriedade para isso).
 */
export function suggestRulePattern(description: string): string | null {
  const tokens = matchText(description).split(" ").filter(Boolean);
  let start = 0;
  while (start < tokens.length && NOISE.has(tokens[start] as string)) start += 1;
  const picked: string[] = [];
  for (const token of tokens.slice(start)) {
    if (/\d/.test(token) || NOISE.has(token) || picked.length === MAX_KEY_TOKENS) break;
    picked.push(token);
  }
  // Sem palavra nenhuma (só números): a descrição inteira, se couber
  const pattern = picked.length > 0 ? picked.join(" ") : tokens.join(" ");
  return normalizeRulePattern(pattern.slice(0, RULE_PATTERN_MAX));
}

// ── Sugestão (a interface única da cascata) ─────────────────────────────────────

/**
 * Quem pode sugerir uma categoria. O M07 tem as duas primeiras camadas; o M09 acrescenta
 * "PROVIDER" (a categoria da Pluggy) e o M10 "CLASSIFIER" e "LLM", como valores novos.
 */
export type SuggestionSource = "RULE" | "HISTORY";

/**
 * Quem decidiu a categoria gravada no lançamento (coluna opcional transaction.categorizedBy):
 * a pessoa (MANUAL) ou a camada da cascata cuja sugestão a pessoa aceitou sem mudar.
 */
export type CategorizationSource = "MANUAL" | SuggestionSource;

export type CategorySuggestion = {
  categoryId: string;
  source: SuggestionSource;
  /** Confiança de 0 a 100 (inteiro). Regra = 100; histórico = % dos votos. */
  confidence: number;
  /** Uma frase para a tela: "regra: contém 'mercado'", "histórico: 4 de 5 vezes". */
  reason: string;
  /** Regra que respondeu (para a tela mostrar e para a auditoria) */
  ruleId?: string;
};

/** O que a cascata recebe. O sinal ajuda a escolher entre categoria de despesa e de receita. */
export type SuggestionInput = { description: string; kind: "expense" | "income" };

/**
 * A interface única de sugestão (padrão adaptador). Cada camada da cascata implementa isto;
 * o M10 acrescenta o classificador como mais um item da lista, sem mudar quem chama.
 */
export interface CategorySuggester {
  readonly source: SuggestionSource;
  suggest(input: SuggestionInput): Promise<CategorySuggestion | null>;
}

/** Roda as camadas em ordem e devolve a primeira sugestão. Descrição vazia: nenhuma. */
export async function runCascade(
  suggesters: readonly CategorySuggester[],
  input: SuggestionInput,
): Promise<CategorySuggestion | null> {
  if (normalizeText(input.description) === "") return null;
  for (const suggester of suggesters) {
    const suggestion = await suggester.suggest(input);
    if (suggestion) return suggestion;
  }
  return null;
}

/** Sugestão por regra: a primeira regra que combina, com confiança 100. */
export function suggestFromRules(
  rules: readonly CategoryRuleLike[],
  description: string,
): CategorySuggestion | null {
  const rule = firstMatchingRule(rules, description);
  if (!rule) return null;
  const how = { CONTAINS: "contém", STARTS_WITH: "começa com", EQUALS: "é igual a" }[rule.match];
  return {
    categoryId: rule.categoryId,
    source: "RULE",
    confidence: 100,
    reason: `regra: ${how} "${rule.pattern}"`,
    ruleId: rule.id,
  };
}

export type HistoryRow = { description: string; categoryId: string };

/** Quantos votos e que fatia mínima o histórico precisa para sugerir. */
export const HISTORY_MIN_VOTES = 2;
export const HISTORY_MIN_SHARE = 60; // %

/**
 * Sugestão pelo histórico: entre os lançamentos já categorizados com a MESMA chave de
 * comerciante, a categoria mais usada, se tiver pelo menos 2 votos e 60% deles.
 * `rows` vem do mais recente para o mais antigo: no empate, vence a usada por último.
 * Divisão inteira para a porcentagem (não é dinheiro, mas o projeto evita float por hábito).
 */
export function suggestFromHistory(
  rows: readonly HistoryRow[],
  description: string,
): CategorySuggestion | null {
  const key = merchantKey(description);
  if (key === "") return null;
  const votes = new Map<string, number>();
  let total = 0;
  for (const row of rows) {
    if (merchantKey(row.description) !== key) continue;
    votes.set(row.categoryId, (votes.get(row.categoryId) ?? 0) + 1);
    total += 1;
  }
  let best: { categoryId: string; count: number } | null = null;
  for (const [categoryId, count] of votes) {
    // Map mantém a ordem de inserção = do mais recente; ">" deixa o mais recente no empate
    if (!best || count > best.count) best = { categoryId, count };
  }
  if (!best || best.count < HISTORY_MIN_VOTES) return null;
  const confidence = Math.floor((best.count * 100) / total);
  if (confidence < HISTORY_MIN_SHARE) return null;
  return {
    categoryId: best.categoryId,
    source: "HISTORY",
    confidence,
    reason: `histórico: ${best.count} de ${total} vezes`,
  };
}

/**
 * Quem fica registrado como autor da categoria: a camada, se a pessoa aceitou a sugestão sem
 * mudar; MANUAL se escolheu outra (ou se não havia sugestão). Sem categoria: null.
 */
export function categorizedBy(
  chosenCategoryId: string | null,
  suggestion: Pick<CategorySuggestion, "categoryId" | "source"> | null,
): CategorizationSource | null {
  if (!chosenCategoryId) return null;
  return suggestion && suggestion.categoryId === chosenCategoryId ? suggestion.source : "MANUAL";
}

/**
 * A escolha da pessoa vira exemplo de treino (M10) quando CORRIGE algo: a sugestão da cascata
 * (no lançamento novo) ou a categoria que já estava gravada (na edição). Aceitar a sugestão
 * não é correção; escolher sem nada sugerido também não (o lançamento já é o exemplo).
 */
export function isCorrection(input: {
  chosenCategoryId: string | null;
  previousCategoryId: string | null;
}): boolean {
  return (
    input.chosenCategoryId !== null &&
    input.previousCategoryId !== null &&
    input.chosenCategoryId !== input.previousCategoryId
  );
}
