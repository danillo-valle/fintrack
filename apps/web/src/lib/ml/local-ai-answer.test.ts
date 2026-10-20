import { describe, expect, it } from "vitest";
import { toLocalAiAnswer } from "./local-ai-answer";

describe("a resposta da IA local", () => {
  it("traduz cada situação do serviço", () => {
    expect(toLocalAiAnswer({ situacao: "SUGERIU", categoria: "Mercado", nova: null })).toEqual({
      outcome: "SUGGESTED",
      category: "Mercado",
    });
    expect(
      toLocalAiAnswer({
        situacao: "NOVA",
        categoria: null,
        nova: { nome: "Academia", mae: "Saúde" },
      }),
    ).toEqual({ outcome: "NEW_CATEGORY", name: "Academia", parent: "Saúde" });
    expect(
      toLocalAiAnswer({ situacao: "NOVA", categoria: null, nova: { nome: "Pets", mae: null } }),
    ).toEqual({ outcome: "NEW_CATEGORY", name: "Pets", parent: null });
    expect(toLocalAiAnswer({ situacao: "NENHUMA", categoria: null, nova: null })).toEqual({
      outcome: "NO_SUGGESTION",
    });
    expect(toLocalAiAnswer({ situacao: "BARRADA", categoria: null, nova: null })).toEqual({
      outcome: "BLOCKED",
    });
  });

  it("resposta incompleta ou desconhecida vira INVÁLIDA (nunca uma categoria inventada)", () => {
    expect(toLocalAiAnswer({ situacao: "SUGERIU", categoria: null, nova: null })).toEqual({
      outcome: "INVALID",
    });
    expect(toLocalAiAnswer({ situacao: "NOVA", categoria: null, nova: null })).toEqual({
      outcome: "INVALID",
    });
    expect(
      toLocalAiAnswer({ situacao: "OUTRA" as "INVALIDA", categoria: "Mercado", nova: null }),
    ).toEqual({ outcome: "INVALID" });
  });
});
