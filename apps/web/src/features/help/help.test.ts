import { describe, expect, it } from "vitest";
import { articleText, HELP_ARTICLES, HELP_TOPICS, helpArticle } from "./content";
import { normalize, queryTerms, searchHelp, snippetFor } from "./search";

const marked = (parts: { text: string; mark: boolean }[]) =>
  parts.filter((p) => p.mark).map((p) => p.text);

describe("o conteúdo da Ajuda", () => {
  it("cada artigo tem um endereço único, um tópico que existe e corpo", () => {
    const slugs = HELP_ARTICLES.map((a) => a.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const a of HELP_ARTICLES) {
      expect(a.slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      expect(HELP_TOPICS.map((t) => t.id)).toContain(a.topic);
      expect(a.body.length).toBeGreaterThan(0);
    }
    for (const t of HELP_TOPICS) expect(HELP_ARTICLES.some((a) => a.topic === t.id)).toBe(true);
  });

  it("nenhum artigo fala em número de cartão além dos 4 últimos dígitos", () => {
    for (const a of HELP_ARTICLES) expect(articleText(a)).not.toMatch(/\d{5,}/);
  });

  it("todo **negrito** abre e fecha", () => {
    for (const a of HELP_ARTICLES) {
      const raw = JSON.stringify(a.body);
      expect((raw.match(/\*\*/g) ?? []).length % 2, a.slug).toBe(0);
    }
  });

  it("helpArticle acha pelo endereço e não inventa", () => {
    expect(helpArticle("contas-e-cartoes")?.title).toBe("Contas e cartões");
    expect(helpArticle("../etc")).toBeNull();
  });
});

describe("a busca", () => {
  it("sem acento e sem caixa", () => {
    expect(normalize("Fatúra ÇÃO")).toBe("fatura cao");
    expect(queryTerms("  Fatura do CARTÃO ")).toEqual(["fatura", "do", "cartao"]);
    expect(queryTerms("a")).toEqual([]);
  });

  it("acha os artigos com todas as palavras, os do título primeiro", () => {
    const results = searchHelp("fatura");
    expect(results.length).toBeGreaterThanOrEqual(3);
    const slugs = results.map((r) => r.slug);
    expect(slugs).toContain("importar");
    expect(slugs).toContain("contas-e-cartoes");
    expect(searchHelp("parcelada")[0]!.slug).toBe("parcelada-e-fixa");
    expect(searchHelp("passkey digital").map((r) => r.slug)).toEqual(["passkeys"]);
    expect(searchHelp("xyzzy")).toEqual([]);
    expect(searchHelp("")).toEqual([]);
  });

  it("o trecho marca a palavra como ela está escrita, com acento", () => {
    const parts = snippetFor("A fatura do cartão fecha no dia 1.", ["cartao"]);
    expect(marked(parts)).toEqual(["cartão"]);
    expect(parts.map((p) => p.text).join("")).toBe("A fatura do cartão fecha no dia 1.");
  });

  it("marca a palavra inteira, não só o pedaço buscado", () => {
    expect(marked(snippetFor("Saldo, faturas e compras.", ["fatura"]))).toEqual(["faturas"]);
  });

  it("o trecho longo corta em palavra inteira, com reticências", () => {
    const long = `${"palavra ".repeat(40)}fatura ${"outra ".repeat(40)}`.trim();
    const parts = snippetFor(long, ["fatura"], 30);
    const text = parts.map((p) => p.text).join("");
    expect(text.startsWith("… ")).toBe(true);
    expect(text.endsWith(" …")).toBe(true);
    expect(marked(parts)).toEqual(["fatura"]);
    expect(text).not.toMatch(/ [a-z]{1,3} …$/); // não termina no meio de uma palavra cortada
  });

  it("o tamanho da busca é limitado (nada de texto gigante na URL)", () => {
    expect(queryTerms("a".repeat(500)).join("").length).toBeLessThanOrEqual(60);
  });
});
