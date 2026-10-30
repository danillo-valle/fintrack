import { describe, expect, it } from "vitest";
import {
  firstNameOf,
  householdPeople,
  initialsOf,
  parsePayerParam,
  payerParam,
  payerTones,
  resolvePayer,
  SHARED_TONE,
} from "./payer";

const card = (holderId: string | null, sharedPurchases = false) => ({ holderId, sharedPurchases });

describe("resolvePayer", () => {
  it("cartão de compras conjuntas: Compartilhado, mesmo com portador", () => {
    expect(resolvePayer({ card: card("nel", true), account: { holderId: "dan" } })).toEqual({
      kind: "shared",
    });
  });

  it("cartão com portador: o portador, não o titular da conta (o adicional)", () => {
    expect(resolvePayer({ card: card("nel"), account: { holderId: "dan" } })).toEqual({
      kind: "person",
      userId: "nel",
    });
  });

  it("sem cartão: o titular da conta (Pix, débito, dinheiro)", () => {
    expect(resolvePayer({ card: null, account: { holderId: "dan" } })).toEqual({
      kind: "person",
      userId: "dan",
    });
  });

  it("cartão sem portador NÃO cai no titular: fica desconhecido", () => {
    expect(resolvePayer({ card: card(null), account: { holderId: "dan" } })).toEqual({
      kind: "unknown",
    });
  });

  it("conta sem titular e sem cartão: desconhecido", () => {
    expect(resolvePayer({ card: null, account: { holderId: null } })).toEqual({ kind: "unknown" });
  });
});

describe("parsePayerParam e payerParam", () => {
  it("vai e volta pela URL", () => {
    expect(parsePayerParam("compartilhado")).toEqual({ kind: "shared" });
    expect(parsePayerParam("abc_123-XY")).toEqual({ kind: "person", userId: "abc_123-XY" });
    expect(payerParam({ kind: "shared" })).toBe("compartilhado");
    expect(payerParam({ kind: "person", userId: "u1" })).toBe("u1");
  });

  it("vazio ou estranho vira 'sem filtro'", () => {
    expect(parsePayerParam(undefined)).toBeNull();
    expect(parsePayerParam("  ")).toBeNull();
    expect(parsePayerParam("'; drop table")).toBeNull();
    expect(parsePayerParam("x".repeat(65))).toBeNull();
  });
});

describe("initialsOf", () => {
  it.each([
    ["Danillo Valle", "DV"],
    ["Nelcimara de Souza Valle", "NV"],
    ["Ana", "AN"],
    ["  ana   maria  ", "AM"],
    ["Élida Ônix", "ÉÔ"],
    ["", "?"],
  ])("%s → %s", (name, initials) => {
    expect(initialsOf(name)).toBe(initials);
  });
});

describe("payerTones", () => {
  it("cores pela ordem de entrada, sem repetir entre as primeiras quatro pessoas", () => {
    const tones = payerTones(["a", "b", "c", "d"]);
    expect([...tones.values()]).toEqual([1, 4, 3, 2]);
    expect(new Set(tones.values()).size).toBe(4);
  });

  it("o tom do Compartilhado nunca é o de uma pessoa", () => {
    expect([...payerTones(["a", "b", "c", "d", "e"]).values()]).not.toContain(SHARED_TONE);
  });
});

describe("householdPeople", () => {
  const day = (d: string) => new Date(`${d}T12:00:00Z`);

  it("pela ordem em que entraram: a cor não depende da ordem em que o banco devolve", () => {
    const people = householdPeople([
      { userId: "b", user: { name: "Caio Moura" }, joinedAt: day("2026-02-01") },
      { userId: "a", user: { name: "Lia Moura" }, joinedAt: day("2026-01-01") },
    ]);
    expect(people).toEqual([
      { userId: "a", name: "Lia Moura", firstName: "Lia", initials: "LM", tone: 1 },
      { userId: "b", name: "Caio Moura", firstName: "Caio", initials: "CM", tone: 4 },
    ]);
  });

  it("lar vazio: lista vazia; nome de uma palavra só", () => {
    expect(householdPeople([])).toEqual([]);
    expect(
      householdPeople([{ userId: "a", user: { name: "Ana" }, joinedAt: day("2026-01-01") }])[0],
    ).toEqual({ userId: "a", name: "Ana", firstName: "Ana", initials: "AN", tone: 1 });
  });
});

describe("firstNameOf", () => {
  it("o primeiro nome, sem espaços sobrando", () => {
    expect(firstNameOf("  Caio   Moura ")).toBe("Caio");
    expect(firstNameOf("Ana")).toBe("Ana");
    expect(firstNameOf("")).toBe("");
  });
});
