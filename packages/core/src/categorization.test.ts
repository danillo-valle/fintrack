// A cascata de categorização (M07): texto normalizado, chave do comerciante, regras,
// histórico e a interface única de sugestão. Tudo sem banco.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  categorizedBy,
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
