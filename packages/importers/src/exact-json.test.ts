import { describe, expect, it } from "vitest";
import { moneyFromText, parseExactJson } from "./exact-json";

describe("parseExactJson", () => {
  it("todo número chega como o texto original (sem ponto flutuante)", () => {
    expect(parseExactJson('{"a":312.48,"b":[0.1,1e2],"c":"x","d":null}')).toEqual({
      a: "312.48",
      b: ["0.1", "1e2"],
      c: "x",
      d: null,
    });
  });
});

describe("moneyFromText", () => {
  it.each([
    ["312.48", 31248n],
    ["-0.5", -50n],
    ["7", 700n],
    ["1e2", 10000n],
    ["4.8615e1", 4862n],
    ["48.615", 4862n],
    ["48.614", 4861n],
    ["0.005", 1n],
    ["-2146.35", -214635n],
  ])("%s → %s centavos", (text, cents) => {
    expect(moneyFromText(text)).toBe(cents);
  });

  it("texto que não é número vira null", () => {
    expect(moneyFromText("12,50")).toBeNull();
    expect(moneyFromText("abc")).toBeNull();
  });

  it("soma de muitos valores fecha ao centavo (o que o float erraria)", () => {
    const values = Array.from({ length: 1000 }, () => "0.10");
    expect(values.reduce((sum, v) => sum + (moneyFromText(v) ?? 0n), 0n)).toBe(10000n);
  });
});
