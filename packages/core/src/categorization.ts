// Categorização de lançamentos (M07): as regras puras da cascata "texto → categoria".
//
// A cascata pergunta, em ordem, a quem sabe responder; a primeira resposta vence:
//
//   1. REGRA         "a descrição contém 'mercado' → Mercado" (CategoryRule, criada pela pessoa,
//                    inclusive a partir de uma correção: "sempre categorizar assim?")
//   2. HISTÓRICO     a categoria que o lar mais usou para o mesmo comerciante (merchantKey)
//   3. BANCO         a categoria que o Meu Pluggy mandou, traduzida para a do lar (M10.1)
//   4. CLASSIFICADOR o modelo do serviço Python, se a confiança chegar a 80 % (M10.1, ADR-015)
//   …  M10.2: um LLM, só numa fila assíncrona, para o que sobrar. Cada camada é um
//      CategorySuggester a mais na lista: quem chama não muda (ADR-007).
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
 * Quem pode sugerir uma categoria NA HORA (a cascata síncrona): as regras e o histórico (M07), a
 * categoria do banco e o classificador (M10.1). A IA local (M10.2b) não está aqui: ela roda numa
 * fila, à noite (local-ai.ts), e grava "LLM" como autor.
 */
export type SuggestionSource = "RULE" | "HISTORY" | "PROVIDER" | "CLASSIFIER";

/** As camadas, na ordem da cascata (a tela e a medida usam esta ordem). */
export const SUGGESTION_SOURCES: readonly SuggestionSource[] = [
  "RULE",
  "HISTORY",
  "PROVIDER",
  "CLASSIFIER",
];

/**
 * Quem decidiu a categoria gravada no lançamento (coluna opcional transaction.categorizedBy):
 * a pessoa (MANUAL), a camada da cascata cuja sugestão a pessoa aceitou sem mudar, ou a IA local
 * (LLM, M10.2b), que só aparece em recebidos das cargas do banco.
 */
export type CategorizationSource = "MANUAL" | SuggestionSource | "LLM";

/**
 * Os autores AUTOMÁTICOS (todas as camadas, inclusive a IA local). Um recebido ainda PENDING
 * categorizado por um deles não vota no histórico nem treina o classificador (votingWhere).
 */
export const AUTOMATIC_SOURCES: readonly CategorizationSource[] = [...SUGGESTION_SOURCES, "LLM"];

export type CategorySuggestion = {
  categoryId: string;
  source: SuggestionSource;
  /** Confiança de 0 a 100 (inteiro). Regra = 100; histórico e banco = % dos votos. */
  confidence: number;
  /** Uma frase para a tela: "regra: contém 'mercado'", "histórico: 4 de 5 vezes". */
  reason: string;
  /** Regra que respondeu (para a tela mostrar e para a auditoria) */
  ruleId?: string;
};

/**
 * O que a cascata recebe. O sinal ajuda a escolher entre categoria de despesa e de receita; a
 * categoria do banco só existe no que veio do Meu Pluggy (M10.1).
 */
export type SuggestionInput = {
  description: string;
  kind: "expense" | "income";
  providerCategory?: string | null;
};

/** O que uma camada respondeu e por quê ("1 lançamento parecido (precisa de 2)"). */
export type LayerOutcome = { suggestion: CategorySuggestion | null; detail: string };

/**
 * A interface única de sugestão (padrão adaptador). Cada camada da cascata implementa isto;
 * `explain` (opcional) diz também POR QUE não sugeriu, para a tela "Por que essa categoria?".
 */
export interface CategorySuggester {
  readonly source: SuggestionSource;
  suggest(input: SuggestionInput): Promise<CategorySuggestion | null>;
  explain?(input: SuggestionInput): Promise<LayerOutcome>;
}

/** Monta uma camada a partir do `explain`: a sugestão é a parte "suggestion" da explicação. */
export function suggesterFrom(
  source: SuggestionSource,
  explain: (input: SuggestionInput) => Promise<LayerOutcome>,
): CategorySuggester {
  return {
    source,
    explain,
    suggest: async (input) => (await explain(input)).suggestion,
  };
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

export type ExplainedLayer = LayerOutcome & {
  source: SuggestionSource;
  /** DECIDED: a camada que respondeu; MISSED: perguntada, sem resposta; SKIPPED: não precisou */
  state: "DECIDED" | "MISSED" | "SKIPPED";
};

/**
 * A cascata explicada camada por camada, para a tela "Por que essa categoria?": a mesma ordem
 * e o mesmo resultado do runCascade; as camadas depois da que decidiu nem são perguntadas.
 */
export async function explainCascade(
  suggesters: readonly CategorySuggester[],
  input: SuggestionInput,
): Promise<{ layers: ExplainedLayer[]; suggestion: CategorySuggestion | null }> {
  const layers: ExplainedLayer[] = [];
  let decided: CategorySuggestion | null = null;
  const empty = normalizeText(input.description) === "";
  for (const suggester of suggesters) {
    if (decided || empty) {
      layers.push({ source: suggester.source, state: "SKIPPED", suggestion: null, detail: "" });
      continue;
    }
    const outcome = suggester.explain
      ? await suggester.explain(input)
      : { suggestion: await suggester.suggest(input), detail: "" };
    decided = outcome.suggestion;
    layers.push({ source: suggester.source, state: decided ? "DECIDED" : "MISSED", ...outcome });
  }
  return { layers, suggestion: decided };
}

// ── Camada 1: regras ────────────────────────────────────────────────────────────

const HOW: Record<RuleMatch, string> = {
  CONTAINS: "contém",
  STARTS_WITH: "começa com",
  EQUALS: "é igual a",
};

export function explainRules(
  rules: readonly CategoryRuleLike[],
  description: string,
): LayerOutcome {
  const rule = firstMatchingRule(rules, description);
  if (!rule) {
    return {
      suggestion: null,
      detail: rules.length === 0 ? "Nenhuma regra criada ainda" : "Nenhuma regra combinou",
    };
  }
  const what = `${HOW[rule.match]} "${rule.pattern}"`;
  return {
    suggestion: {
      categoryId: rule.categoryId,
      source: "RULE",
      confidence: 100,
      reason: `regra: ${what}`,
      ruleId: rule.id,
    },
    detail: `A descrição ${what}`,
  };
}

/** Sugestão por regra: a primeira regra que combina, com confiança 100. */
export function suggestFromRules(
  rules: readonly CategoryRuleLike[],
  description: string,
): CategorySuggestion | null {
  return explainRules(rules, description).suggestion;
}

// ── Camadas 2 e 3: votos (histórico e banco) ────────────────────────────────────

export type HistoryRow = { description: string; categoryId: string };

/** Quantos votos e que fatia mínima o histórico (e o banco) precisam para sugerir. */
export const HISTORY_MIN_VOTES = 2;
export const HISTORY_MIN_SHARE = 60; // %

type Vote = { categoryId: string; count: number; total: number };

/** A categoria mais votada (no empate, a que apareceu primeiro = a mais recente). */
function tally(categoryIds: Iterable<string>): Vote | null {
  const votes = new Map<string, number>();
  let total = 0;
  for (const categoryId of categoryIds) {
    votes.set(categoryId, (votes.get(categoryId) ?? 0) + 1);
    total += 1;
  }
  let best: { categoryId: string; count: number } | null = null;
  for (const [categoryId, count] of votes) {
    // Map mantém a ordem de inserção = do mais recente; ">" deixa o mais recente no empate
    if (!best || count > best.count) best = { categoryId, count };
  }
  return best ? { ...best, total } : null;
}

/** Divisão inteira para a porcentagem (não é dinheiro, mas o projeto evita float por hábito). */
const shareOf = (vote: Vote) => Math.floor((vote.count * 100) / vote.total);

/** Por que os votos não bastam (ou null se bastam). `what`: [singular, plural]. */
function weakVote(vote: Vote | null, what: readonly [string, string]): string | null {
  if (!vote) return `Nenhum ${what[0]}`;
  if (vote.count < HISTORY_MIN_VOTES) {
    return vote.total === 1
      ? `1 ${what[0]} (precisa de ${HISTORY_MIN_VOTES})`
      : `${vote.total} ${what[1]}, cada um numa categoria (precisa de ${HISTORY_MIN_VOTES} iguais)`;
  }
  if (shareOf(vote) < HISTORY_MIN_SHARE) {
    return `Os ${what[1]} estão divididos: ${vote.count} de ${vote.total} (precisa de ${HISTORY_MIN_SHARE} %)`;
  }
  return null;
}

const SIMILAR = [
  "lançamento parecido nas carteiras que você vê",
  "lançamentos parecidos nas carteiras que você vê",
] as const;
const CHOICES = ["escolha sua para esse texto", "escolhas suas para esse texto"] as const;

/**
 * Pelo histórico: entre os lançamentos já categorizados com a MESMA chave de comerciante, a
 * categoria mais usada, se tiver pelo menos 2 votos e 60% deles. `rows` vem do mais recente
 * para o mais antigo: no empate, vence a usada por último.
 */
export function explainHistory(rows: readonly HistoryRow[], description: string): LayerOutcome {
  const key = merchantKey(description);
  if (key === "") return { suggestion: null, detail: "A descrição não tem nome de comerciante" };
  const vote = tally(
    rows.filter((row) => merchantKey(row.description) === key).map((row) => row.categoryId),
  );
  const weak = weakVote(vote, SIMILAR);
  if (weak || !vote) return { suggestion: null, detail: weak ?? "" };
  return {
    suggestion: {
      categoryId: vote.categoryId,
      source: "HISTORY",
      confidence: shareOf(vote),
      reason: `histórico: ${vote.count} de ${vote.total} vezes`,
    },
    detail: `${vote.count} de ${vote.total} lançamentos parecidos nesta categoria`,
  };
}

export function suggestFromHistory(
  rows: readonly HistoryRow[],
  description: string,
): CategorySuggestion | null {
  return explainHistory(rows, description).suggestion;
}

export type ProviderRow = { providerCategory: string; categoryId: string };

/** Confiança do banco quando só o NOME bate ("Farmácia" do banco = "Farmácia" do lar). */
export const PROVIDER_NAME_CONFIDENCE = 80;

/** "Restaurantes" e "restaurante" são o mesmo nome; "Supermercados" e "Mercado", não. */
const sameName = (a: string, b: string) => {
  const singular = (text: string) => matchText(text).replace(/s\b/g, "");
  return singular(a) !== "" && singular(a) === singular(b);
};

/**
 * Pela categoria do banco (M10.1): o banco manda um texto ("Supermercados") que não é uma
 * categoria do lar. Duas pistas, nesta ordem:
 *   1. o que a pessoa escolheu antes para o mesmo texto do banco (votos, como o histórico)
 *   2. uma categoria do lar com o mesmo nome (confiança 80)
 * `rows` vem do mais recente; `categories` são só as ativas e do tipo certo.
 */
export function explainProvider(
  rows: readonly ProviderRow[],
  providerCategory: string | null | undefined,
  categories: readonly { id: string; name: string }[],
): LayerOutcome {
  const said = providerCategory?.trim();
  if (!said) return { suggestion: null, detail: "O banco não mandou categoria" };
  const key = matchText(said);
  const vote = tally(
    rows.filter((row) => matchText(row.providerCategory) === key).map((row) => row.categoryId),
  );
  const quoted = `"${said.slice(0, 40)}"`;
  if (vote && !weakVote(vote, CHOICES)) {
    return {
      suggestion: {
        categoryId: vote.categoryId,
        source: "PROVIDER",
        confidence: shareOf(vote),
        reason: `banco: ${quoted}, ${vote.count} de ${vote.total} vezes`,
      },
      detail: `O banco disse ${quoted}; você escolheu esta categoria ${vote.count} de ${vote.total} vezes`,
    };
  }
  const named = categories.find((category) => sameName(category.name, said));
  if (named) {
    return {
      suggestion: {
        categoryId: named.id,
        source: "PROVIDER",
        confidence: PROVIDER_NAME_CONFIDENCE,
        reason: `banco: ${quoted}, mesmo nome`,
      },
      detail: `O banco disse ${quoted}, o mesmo nome de uma categoria sua`,
    };
  }
  return {
    suggestion: null,
    detail: vote
      ? `O banco disse ${quoted}, mas ${weakVote(vote, CHOICES)?.toLowerCase()}`
      : `O banco disse ${quoted}, que ainda não está ligado a uma categoria sua`,
  };
}

// ── Camada 4: o classificador (M10.1, ADR-015) ──────────────────────────────────

/** A partir de quanto o classificador sugere. Abaixo disso: sem sugestão (M10.2: fila do LLM). */
export const CLASSIFIER_THRESHOLD = 80;

/** Uma resposta do serviço: a categoria, a confiança (0 a 100) e o modelo (id da carteira). */
export type ClassifierCandidate = { categoryId: string; confidence: number; model: string };

export type TrainingExample = {
  description: string;
  kind: "expense" | "income";
  categoryId: string;
};

/**
 * O serviço Python visto pelo resto do app (porta). Quem implementa é o app web (HTTP com o
 * token curto); os testes usam uma porta de mentira. Nenhum método recebe o lar: só os modelos
 * (ids das carteiras) que quem chama PODE consultar.
 */
export interface ClassifierPort {
  suggest(input: {
    models: readonly string[];
    description: string;
    kind: "expense" | "income";
  }): Promise<ClassifierCandidate[]>;
  train(input: {
    model: string;
    examples: readonly TrainingExample[];
  }): Promise<{ examples: number; categories: number } | "TOO_FEW">;
  remove(model: string): Promise<void>;
}

/**
 * A resposta do classificador vira sugestão: a 1ª candidata que é uma categoria usável (ativa,
 * do lar e do tipo certo), se a confiança chegar ao limiar. `candidates` null = serviço fora.
 */
export function explainClassifier(
  candidates: readonly ClassifierCandidate[] | null,
  categories: readonly { id: string; name: string }[],
  models: number,
): LayerOutcome {
  if (models === 0) {
    return { suggestion: null, detail: "Ainda sem modelo treinado nas carteiras que você vê" };
  }
  if (candidates === null) return { suggestion: null, detail: "O classificador não respondeu" };
  const names = new Map(categories.map((c) => [c.id, c.name]));
  const best = candidates.find((c) => names.has(c.categoryId));
  if (!best) return { suggestion: null, detail: "Nenhuma categoria conhecida" };
  const name = names.get(best.categoryId) as string;
  if (best.confidence < CLASSIFIER_THRESHOLD) {
    return {
      suggestion: null,
      detail: `${name} ficou em ${best.confidence} % (sugere a partir de ${CLASSIFIER_THRESHOLD} %)`,
    };
  }
  return {
    suggestion: {
      categoryId: best.categoryId,
      source: "CLASSIFIER",
      confidence: best.confidence,
      reason: `classificador: ${best.confidence} % de confiança`,
    },
    detail: `${name}, ${best.confidence} % de confiança (sugere a partir de ${CLASSIFIER_THRESHOLD} %)`,
  };
}

// ── A medida: quem categorizou (M10.1) ──────────────────────────────────────────

export type BreakdownKey = CategorizationSource | "NONE";
/** A ordem da tela: as camadas da cascata, a IA local, a pessoa e os sem categoria. */
export const BREAKDOWN_ORDER: readonly BreakdownKey[] = [
  ...SUGGESTION_SOURCES,
  "LLM",
  "MANUAL",
  "NONE",
];

/** Décimos de porcentagem, arredondando metade para cima: 378 de 412 → 917 (91,7 %). */
export function tenthsOf(part: number, total: number): number {
  if (total <= 0) return 0;
  return Math.floor((part * 2000 + total) / (2 * total));
}

export type Breakdown = {
  total: number;
  /** Categorizados por alguma camada automática SEM IA (regra, histórico, banco, classificador).
   * A IA local (LLM) conta no total, mas não aqui: é o "percentual sem IA". */
  automatic: number;
  automaticTenths: number;
  rows: { key: BreakdownKey; count: number; tenths: number }[];
};

/**
 * O "percentual sem IA" e a parte de cada camada, a partir das contagens do banco. O total
 * inclui os escolhidos pela pessoa e os sem categoria: a medida é o quanto a cascata resolveu
 * sozinha, sem LLM. Lançamento antigo com categoria e sem autor conta como da pessoa.
 */
export function categorizationBreakdown(counts: Partial<Record<BreakdownKey, number>>): Breakdown {
  const rows = BREAKDOWN_ORDER.map((key) => ({ key, count: counts[key] ?? 0 }));
  const total = rows.reduce((sum, row) => sum + row.count, 0);
  const automatic = rows
    .filter((row) => (SUGGESTION_SOURCES as readonly string[]).includes(row.key))
    .reduce((sum, row) => sum + row.count, 0);
  return {
    total,
    automatic,
    automaticTenths: tenthsOf(automatic, total),
    rows: rows.map((row) => ({ ...row, tenths: tenthsOf(row.count, total) })),
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

/** A confiança gravada junto (M10.1): a da camada, se a pessoa aceitou; senão, nenhuma. */
export function categorizationConfidence(
  chosenCategoryId: string | null,
  suggestion: Pick<CategorySuggestion, "categoryId" | "confidence"> | null,
): number | null {
  return chosenCategoryId && suggestion?.categoryId === chosenCategoryId
    ? suggestion.confidence
    : null;
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
