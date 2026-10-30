import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { cleanText } from "./text";

describe("cleanText", () => {
  it("tira o caractere nulo, que o Postgres não guarda", () => {
    expect(cleanText("mer\u0000cado")).toBe("mercado");
    expect(cleanText("\u0000")).toBe("");
  });

  it("tira os invisíveis que esconderiam um número de cartão", () => {
    const zeroWidth = ["\u200b", "\u200c", "\u200d", "\u2060", "\ufeff", "\u00ad"];
    for (const z of zeroWidth) expect(cleanText(`4111${z}1111`)).toBe("41111111");
    // A direção do texto (o truque de mostrar "gpj.exe" como "exe.jpg")
    expect(cleanText("abc\u202edef\u202c")).toBe("abcdef");
  });

  it("troca os espaços diferentes e os controles que separam palavras por um espaço", () => {
    expect(cleanText("4111\u00a02222\u20073333\u202f4444")).toBe("4111 2222 3333 4444");
    expect(cleanText("a\tb\nc\r\nd\u2028e\u0085f")).toBe("a b c  d e f");
    expect(cleanText("a\u0007b\u001bc\u007fd")).toBe("abcd");
  });

  it("tira a metade solta de um par UTF-16, mas não um emoji inteiro", () => {
    expect(cleanText("a\ud83db")).toBe("ab");
    expect(cleanText("Mercado 🛒 Pão de Açúcar")).toBe("Mercado 🛒 Pão de Açúcar");
  });

  it("não deixa nenhum caractere de controle ou invisível, seja qual for o texto", () => {
    // Texto de qualquer parte do Unicode, com mais peso para o que interessa: os controles, os
    // invisíveis, os espaços diferentes e as metades de par (o fc.string binário é lento demais)
    const codePoint = fc.oneof(
      fc.integer({ min: 0, max: 0x9f }),
      fc.constantFrom(0xad, 0xa0, 0x2007, 0x202f, 0x3000, 0x2028, 0x2029, 0xfeff, 0xe0001),
      fc.integer({ min: 0x200b, max: 0x206f }),
      fc.integer({ min: 0xd800, max: 0xdfff }),
      fc.integer({ min: 0, max: 0x10ffff }),
    );
    const anyText = fc
      .array(codePoint, { maxLength: 40 })
      .map((points) => points.map((point) => String.fromCodePoint(point)).join(""));
    fc.assert(
      fc.property(anyText, (text) => {
        const clean = cleanText(text);
        expect(clean).not.toMatch(/[\p{Cc}\p{Cf}\p{Cs}]/u);
        // Limpar de novo não muda nada
        expect(cleanText(clean)).toBe(clean);
      }),
    );
  });

  it("deixa o texto comum como está", () => {
    fc.assert(
      fc.property(fc.stringMatching(/^[\w ,.;:!?()@#%&*+=/áéíóúâêôãõçÁÉÍÓÚÂÊÔÃÕÇ-]*$/), (text) => {
        expect(cleanText(text)).toBe(text);
      }),
    );
  });
});
