// A cascata de categorização (M07): texto normalizado, chave do comerciante, regras,
// histórico e a interface única de sugestão. Tudo sem banco.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  BREAKDOWN_ORDER,
  CLASSIFIER_THRESHOLD,
  categorizationBreakdown,
  categorizationConfidence,
  categorizedBy,
  explainCascade,
  explainClassifier,
  explainHistory,
  explainProvider,
  explainRules,
  suggesterFrom,
  tenthsOf,
  firstMatchingRule,
  isCorrection,
  merchantKey,
  normalizeRulePattern,
  normalizeText,
  ruleMatches,
  runCascade,
  suggestFromHistory,
  suggestFromRules,
  suggestRulePattern,
  type CategoryRuleLike,
  type CategorySuggester,
} from "./categorization";

describe("normalizeText", () => {
  it.each([
    ["  PADARIA São João  ", "padaria sao joao"],
    ["Açaí  da   Esquina", "acai da esquina"],
    ["", ""],
  ])("%j → %j", (input, expected) => {
    expect(normalizeText(input)).toBe(expected);
  });

  it("propriedade: normalizar duas vezes dá o mesmo que uma", () => {
    fc.assert(
      fc.property(fc.string(), (s) => normalizeText(normalizeText(s)) === normalizeText(s)),
    );
  });
});

describe("merchantKey: a mesma loja ganha a mesma chave", () => {
  it.each([
    ["PADARIA SÃO JOÃO 02/10", "padaria sao joao"],
    ["Padaria Sao Joao", "padaria sao joao"],
    ["Netflix.com parc 03/12", "netflix"], // "com" é preposição: sai,
    ["MERCADO BOM PRECO LTDA 4432", "mercado bom preco"],
    ["COMPRA CARTAO - POSTO SHELL 123456", "posto shell"],
    ["Pag*Ifood Restaurante", "ifood restaurante"],
    ["123 456", ""],
  ])("%j → %j", (input, expected) => {
    expect(merchantKey(input)).toBe(expected);
  });

  it("parcelas diferentes da mesma compra têm a mesma chave", () => {
    expect(merchantKey("Loja X parc 01/10")).toBe(merchantKey("LOJA X PARC 07/10"));
  });
});

const rule = (over: Partial<CategoryRuleLike>): CategoryRuleLike => ({
  id: "r1",
  categoryId: "cat-mercado",
  pattern: "mercado",
  match: "CONTAINS",
  priority: 100,
  ...over,
});

describe("regras texto → categoria", () => {
  it("contém, começa com e é igual, sem acento e sem maiúscula", () => {
    expect(ruleMatches(rule({ pattern: "mercado" }), "Supermercado Bom Preço")).toBe(true);
    expect(ruleMatches(rule({ match: "STARTS_WITH", pattern: "uber" }), "UBER *TRIP")).toBe(true);
    expect(ruleMatches(rule({ match: "STARTS_WITH", pattern: "uber" }), "Pag Uber")).toBe(false);
    expect(ruleMatches(rule({ match: "EQUALS", pattern: "aluguel" }), "Aluguel")).toBe(true);
    expect(ruleMatches(rule({ match: "EQUALS", pattern: "aluguel" }), "Aluguel 10/26")).toBe(false);
    expect(ruleMatches(rule({ pattern: "cafe" }), "Café do Ponto")).toBe(true);
  });

  it("menor prioridade vence; empate, o padrão mais longo (mais específico)", () => {
    const rules = [
      rule({ id: "a", pattern: "posto", categoryId: "carro", priority: 100 }),
      rule({ id: "b", pattern: "posto shell", categoryId: "shell", priority: 100 }),
      rule({ id: "c", pattern: "shell", categoryId: "urgente", priority: 10 }),
    ];
    expect(firstMatchingRule(rules, "POSTO SHELL 123")?.id).toBe("c");
    expect(firstMatchingRule(rules.slice(0, 2), "POSTO SHELL 123")?.id).toBe("b");
    expect(firstMatchingRule(rules.slice(0, 2), "Posto Ipiranga")?.id).toBe("a");
    expect(firstMatchingRule(rules, "Farmácia")).toBeNull();
  });

  it("padrão normalizado e com tamanho de 2 a 100 (o mesmo CHECK do banco)", () => {
    expect(normalizeRulePattern("  Mercado  ")).toBe("mercado");
    expect(normalizeRulePattern("x")).toBeNull();
    expect(normalizeRulePattern("a".repeat(101))).toBeNull();
  });

  it("sugere o padrão da regra a partir da descrição corrigida", () => {
    expect(suggestRulePattern("PADARIA SÃO JOÃO 02/10")).toBe("padaria sao joao");
    expect(suggestRulePattern("COMPRA CARTAO - POSTO SHELL 123456")).toBe("posto shell");
    expect(suggestRulePattern("Padaria da Esquina 02/10")).toBe("padaria da esquina");
    expect(suggestRulePattern("12345")).toBe("12345"); // sem palavra: a descrição normalizada
    expect(suggestRulePattern("x")).toBeNull();
  });

  it("propriedade: a regra sugerida numa correção combina com a própria descrição", () => {
    fc.assert(
      fc.property(fc.stringMatching(/^[A-Za-zÀ-ú0-9 ./*-]{2,60}$/), (description) => {
        const pattern = suggestRulePattern(description);
        if (pattern) expect(ruleMatches({ pattern, match: "CONTAINS" }, description)).toBe(true);
      }),
    );
  });

  it("a regra combina mesmo com a pontuação que o banco põe na descrição", () => {
    expect(ruleMatches(rule({ pattern: "netflix com" }), "NETFLIX.COM*ASSINATURA")).toBe(true);
  });
});

describe("histórico do lar", () => {
  const rows = [
    { description: "Padaria São João 02/10", categoryId: "padaria" },
    { description: "PADARIA SAO JOAO", categoryId: "padaria" },
    { description: "Padaria São João", categoryId: "mercado" },
    { description: "Posto Shell", categoryId: "carro" },
  ];

  it("sugere a categoria mais usada para o mesmo comerciante", () => {
    expect(suggestFromHistory(rows, "padaria sao joao 15/10")).toEqual({
      categoryId: "padaria",
      source: "HISTORY",
      confidence: 66,
      reason: "histórico: 2 de 3 vezes",
    });
  });

  it("precisa de pelo menos 2 votos", () => {
    expect(suggestFromHistory(rows, "Posto Shell")).toBeNull();
  });

  it("precisa de pelo menos 60% dos votos", () => {
    const split = [
      { description: "Loja A", categoryId: "x" },
      { description: "Loja A", categoryId: "x" },
      { description: "Loja A", categoryId: "y" },
      { description: "Loja A", categoryId: "y" },
    ];
    expect(suggestFromHistory(split, "Loja A")).toBeNull();
  });

  it("comerciante desconhecido ou descrição sem chave: nada", () => {
    expect(suggestFromHistory(rows, "Farmácia")).toBeNull();
    expect(suggestFromHistory(rows, "123")).toBeNull();
  });
});

describe("a cascata (interface única de sugestão)", () => {
  const fixed = (source: "RULE" | "HISTORY", categoryId: string | null): CategorySuggester => ({
    source,
    suggest: async () =>
      categoryId ? { categoryId, source, confidence: 100, reason: source } : null,
  });

  it("a primeira camada que responde vence", async () => {
    const out = await runCascade([fixed("RULE", "a"), fixed("HISTORY", "b")], {
      description: "x y",
      kind: "expense",
    });
    expect(out?.categoryId).toBe("a");
  });

  it("camada sem resposta passa a vez para a próxima", async () => {
    const out = await runCascade([fixed("RULE", null), fixed("HISTORY", "b")], {
      description: "x y",
      kind: "expense",
    });
    expect(out?.source).toBe("HISTORY");
  });

  it("descrição vazia nem chama as camadas", async () => {
    let called = false;
    const spy: CategorySuggester = {
      source: "RULE",
      suggest: async () => {
        called = true;
        return null;
      },
    };
    expect(await runCascade([spy], { description: "   ", kind: "expense" })).toBeNull();
    expect(called).toBe(false);
  });

  it("suggestFromRules explica a regra que respondeu", () => {
    expect(suggestFromRules([rule({})], "Mercado Dia")).toEqual({
      categoryId: "cat-mercado",
      source: "RULE",
      confidence: 100,
      reason: 'regra: contém "mercado"',
      ruleId: "r1",
    });
  });
});

describe("quem categorizou e o que é correção (exemplo de treino)", () => {
  const suggestion = { categoryId: "a", source: "RULE" as const };

  it("aceitou a sugestão: o autor é a camada; escolheu outra: MANUAL", () => {
    expect(categorizedBy("a", suggestion)).toBe("RULE");
    expect(categorizedBy("b", suggestion)).toBe("MANUAL");
    expect(categorizedBy("b", null)).toBe("MANUAL");
    expect(categorizedBy(null, suggestion)).toBeNull();
  });

  it("correção = trocar algo que existia por outra categoria", () => {
    expect(isCorrection({ chosenCategoryId: "b", previousCategoryId: "a" })).toBe(true);
    expect(isCorrection({ chosenCategoryId: "a", previousCategoryId: "a" })).toBe(false);
    expect(isCorrection({ chosenCategoryId: "a", previousCategoryId: null })).toBe(false);
    expect(isCorrection({ chosenCategoryId: null, previousCategoryId: "a" })).toBe(false);
  });
});

// ── M10.1: banco, classificador, explicação e a medida ───────────────────────────

const CATS = [
  { id: "c-mercado", name: "Mercado" },
  { id: "c-farmacia", name: "Farmácia" },
  { id: "c-rest", name: "Restaurante" },
];

describe("explainProvider: a categoria do banco traduzida para a do lar", () => {
  it("sem categoria do banco não sugere", () => {
    expect(explainProvider([], null, CATS)).toEqual({
      suggestion: null,
      detail: "O banco não mandou categoria",
    });
  });

  it("vota pelo que a pessoa escolheu antes para o mesmo texto do banco (sem acento/caixa)", () => {
    const rows = [
      { providerCategory: "Supermercados", categoryId: "c-mercado" },
      { providerCategory: "SUPERMERCADOS", categoryId: "c-mercado" },
      { providerCategory: "supermercados", categoryId: "c-farmacia" },
      { providerCategory: "Farmácia", categoryId: "c-farmacia" },
    ];
    const out = explainProvider(rows, "Supermercados", CATS);
    expect(out.suggestion).toMatchObject({
      categoryId: "c-mercado",
      source: "PROVIDER",
      confidence: 66,
    });
    expect(out.detail).toContain("2 de 3 vezes");
  });

  it("sem votos, o mesmo nome (singular ou plural) vale com confiança 80", () => {
    expect(explainProvider([], "Restaurantes", CATS).suggestion).toMatchObject({
      categoryId: "c-rest",
      confidence: 80,
    });
    expect(explainProvider([], "farmacia", CATS).suggestion?.categoryId).toBe("c-farmacia");
    // "Supermercados" não é "Mercado": nada de adivinhar
    const out = explainProvider([], "Supermercados", CATS);
    expect(out.suggestion).toBeNull();
    expect(out.detail).toContain("ainda não está ligado");
  });

  it("um voto só não basta, e o motivo aparece", () => {
    const out = explainProvider(
      [{ providerCategory: "Livrarias", categoryId: "c-mercado" }],
      "Livrarias",
      CATS,
    );
    expect(out.suggestion).toBeNull();
    expect(out.detail).toContain("precisa de 2");
  });
});

describe("explainClassifier: limiar de 80 e só categoria usável", () => {
  const c = (categoryId: string, confidence: number) => ({ categoryId, confidence, model: "m" });

  it("sem modelo, serviço fora, ou nada conhecido: não sugere e diz por quê", () => {
    expect(explainClassifier([], CATS, 0).detail).toContain("sem modelo treinado");
    expect(explainClassifier(null, CATS, 1).detail).toBe("O classificador não respondeu");
    expect(explainClassifier([c("arquivada", 99)], CATS, 1).detail).toBe(
      "Nenhuma categoria conhecida",
    );
  });

  it("pula a candidata que não é usável (arquivada, outro tipo) e aplica o limiar", () => {
    const out = explainClassifier([c("arquivada", 99), c("c-rest", 92)], CATS, 2);
    expect(out.suggestion).toMatchObject({
      categoryId: "c-rest",
      source: "CLASSIFIER",
      confidence: 92,
    });
    const low = explainClassifier([c("c-rest", CLASSIFIER_THRESHOLD - 1)], CATS, 1);
    expect(low.suggestion).toBeNull();
    expect(low.detail).toBe("Restaurante ficou em 79 % (sugere a partir de 80 %)");
    expect(explainClassifier([c("c-rest", 80)], CATS, 1).suggestion?.confidence).toBe(80);
  });
});

describe("explainRules / explainHistory: os motivos", () => {
  it("regra: o que combinou, ou por que não", () => {
    expect(explainRules([], "PADARIA").detail).toBe("Nenhuma regra criada ainda");
    const rule = {
      id: "r",
      categoryId: "c",
      pattern: "padaria",
      match: "CONTAINS" as const,
      priority: 1,
    };
    expect(explainRules([rule], "Café").detail).toBe("Nenhuma regra combinou");
    expect(explainRules([rule], "PADARIA DO BAIRRO").detail).toBe('A descrição contém "padaria"');
  });

  it("histórico: 1 parecido só, divididos, ou sem comerciante", () => {
    expect(explainHistory([], "123 456").detail).toBe("A descrição não tem nome de comerciante");
    const one = explainHistory([{ description: "PADARIA X", categoryId: "a" }], "Padaria X 02/10");
    expect(one.detail).toBe("1 lançamento parecido nas carteiras que você vê (precisa de 2)");
    const split = explainHistory(
      ["a", "a", "b", "b", "c"].map((categoryId) => ({ description: "PADARIA X", categoryId })),
      "PADARIA X",
    );
    expect(split.suggestion).toBeNull();
    expect(split.detail).toContain("divididos: 2 de 5");
  });
});

describe("explainCascade: a mesma resposta do runCascade, camada por camada", () => {
  const layer = (source: "RULE" | "HISTORY" | "PROVIDER" | "CLASSIFIER", answer: string | null) =>
    suggesterFrom(source, async () => ({
      suggestion: answer
        ? { categoryId: answer, source, confidence: 90, reason: source.toLowerCase() }
        : null,
      detail: answer ? `decidiu ${answer}` : "não",
    }));

  it("depois da que decidiu, as outras nem são perguntadas", async () => {
    let asked = 0;
    const spy = suggesterFrom("CLASSIFIER", async () => {
      asked += 1;
      return { suggestion: null, detail: "" };
    });
    const out = await explainCascade(
      [layer("RULE", null), layer("HISTORY", null), layer("PROVIDER", "c-mercado"), spy],
      { description: "SUPERMERC", kind: "expense", providerCategory: "Supermercados" },
    );
    expect(out.layers.map((l) => l.state)).toEqual(["MISSED", "MISSED", "DECIDED", "SKIPPED"]);
    expect(out.suggestion?.categoryId).toBe("c-mercado");
    expect(asked).toBe(0);
    const same = await runCascade(
      [layer("RULE", null), layer("HISTORY", null), layer("PROVIDER", "c-mercado")],
      { description: "SUPERMERC", kind: "expense" },
    );
    expect(same).toEqual(out.suggestion);
  });

  it("descrição vazia: nenhuma camada é perguntada", async () => {
    const out = await explainCascade([layer("RULE", "x")], { description: "  ", kind: "expense" });
    expect(out).toEqual({
      layers: [expect.objectContaining({ state: "SKIPPED" })],
      suggestion: null,
    });
  });
});

describe("categorizationBreakdown: o percentual sem IA", () => {
  it("a IA local entra no total e na lista, mas não no percentual sem IA (canvas F)", () => {
    const b = categorizationBreakdown({
      RULE: 168,
      HISTORY: 92,
      PROVIDER: 57,
      CLASSIFIER: 61,
      LLM: 26,
      NONE: 8,
    });
    expect(b).toMatchObject({ total: 412, automatic: 378, automaticTenths: 917 });
    expect(b.rows.find((r) => r.key === "LLM")).toEqual({ key: "LLM", count: 26, tenths: 63 });
    expect(BREAKDOWN_ORDER.indexOf("LLM")).toBe(BREAKDOWN_ORDER.indexOf("CLASSIFIER") + 1);
  });

  it("o exemplo do canvas: 378 de 412 → 91,7 %", () => {
    const b = categorizationBreakdown({
      RULE: 168,
      HISTORY: 92,
      PROVIDER: 57,
      CLASSIFIER: 61,
      MANUAL: 26,
      NONE: 8,
    });
    expect(b).toMatchObject({ total: 412, automatic: 378, automaticTenths: 917 });
    expect(b.rows.map((r) => r.key)).toEqual(BREAKDOWN_ORDER);
    expect(b.rows.find((r) => r.key === "RULE")?.tenths).toBe(408);
  });

  it("vazio dá zero, sem dividir por zero", () => {
    expect(categorizationBreakdown({})).toMatchObject({ total: 0, automaticTenths: 0 });
  });

  it("propriedade: décimos entre 0 e 1000 e meio para cima", () => {
    expect(tenthsOf(1, 8)).toBe(125);
    expect(tenthsOf(1, 3)).toBe(333);
    expect(tenthsOf(2, 3)).toBe(667);
    fc.assert(
      fc.property(fc.nat(10_000), fc.nat(10_000), (a, b) => {
        const total = a + b;
        const t = tenthsOf(a, total);
        return t >= 0 && t <= 1000 && (total === 0 || Math.abs(t * total - a * 1000) <= total);
      }),
    );
  });
});

describe("categorizationConfidence: só quando a pessoa aceitou a sugestão", () => {
  it.each([
    ["c1", { categoryId: "c1", confidence: 92 }, 92],
    ["c2", { categoryId: "c1", confidence: 92 }, null],
    [null, { categoryId: "c1", confidence: 92 }, null],
    ["c1", null, null],
  ] as const)("%j com %j → %j", (chosen, suggestion, expected) => {
    expect(categorizationConfidence(chosen, suggestion)).toBe(expected);
  });
});
