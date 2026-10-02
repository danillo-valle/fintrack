import { describe, expect, it } from "vitest";
import { isEmailAllowed, normalizeEmail, parseAllowedEmails } from "./allowlist";

describe("parseAllowedEmails", () => {
  it("separa por vírgula, tira espaços e padroniza em minúsculas", () => {
    expect(parseAllowedEmails(" Ana@Casa.com ,bruno@casa.com,, ")).toEqual([
      "ana@casa.com",
      "bruno@casa.com",
    ]);
  });

  it("remove repetidos", () => {
    expect(parseAllowedEmails("a@x.com,A@X.com")).toEqual(["a@x.com"]);
  });

  it("recusa um item que não é e-mail, para um erro de digitação não passar despercebido", () => {
    expect(() => parseAllowedEmails("ana@casa.com,bruno-casa.com")).toThrow(/bruno-casa\.com/);
  });
});

describe("isEmailAllowed", () => {
  const allowed = parseAllowedEmails("ana@casa.com,bruno@casa.com");

  it("aceita quem está na lista, com qualquer combinação de maiúsculas", () => {
    expect(isEmailAllowed("ana@casa.com", allowed)).toBe(true);
    expect(isEmailAllowed("  BRUNO@Casa.com ", allowed)).toBe(true);
  });

  it("recusa quem não está, inclusive variações parecidas", () => {
    expect(isEmailAllowed("intruso@casa.com", allowed)).toBe(false);
    expect(isEmailAllowed("ana@casa.com.br", allowed)).toBe(false);
    expect(isEmailAllowed("ana+x@casa.com", allowed)).toBe(false);
  });

  it("com a lista vazia, ninguém entra", () => {
    expect(isEmailAllowed("ana@casa.com", [])).toBe(false);
  });
});

describe("normalizeEmail", () => {
  it("só muda espaços e maiúsculas", () => {
    expect(normalizeEmail(" Ana.Silva@Casa.COM ")).toBe("ana.silva@casa.com");
  });
});
