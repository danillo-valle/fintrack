import { describe, expect, it } from "vitest";
import {
  appendDigits,
  centsToDecimal,
  decimalToCents,
  digitsToCents,
  dropLastDigit,
  formatBRL,
} from "./money";

// O Intl usa espaço não separável (U+00A0) entre "R$" e o número
const nbsp = (s: string) => s.replace(/ /g, "\u00a0");

describe("centsToDecimal", () => {
  it.each([
    [0n, "0.00"],
    [1n, "0.01"],
    [123456n, "1234.56"],
    [-5000n, "-50.00"],
    [99999999999n, "999999999.99"],
  ])("%s centavos viram %s", (cents, expected) => {
    expect(centsToDecimal(cents)).toBe(expected);
  });
});

describe("decimalToCents", () => {
  it("converte de volta sem perder centavos", () => {
    expect(decimalToCents("1234.56")).toBe(123456n);
    expect(decimalToCents("1234.5")).toBe(123450n);
    expect(decimalToCents("-0.01")).toBe(-1n);
    expect(decimalToCents("7")).toBe(700n);
  });

  it("recusa formatos ambíguos", () => {
    expect(() => decimalToCents("1.234,56")).toThrow();
    expect(() => decimalToCents("12.345")).toThrow();
    expect(() => decimalToCents("")).toThrow();
  });

  it("ida e volta preserva o valor", () => {
    for (const cents of [0n, 1n, 10n, 99n, 100n, 123456789n, -42n]) {
      expect(decimalToCents(centsToDecimal(cents))).toBe(cents);
    }
  });
});

describe("formatBRL", () => {
  it("formata no padrão brasileiro", () => {
    expect(formatBRL(123456n)).toBe(nbsp("R$ 1.234,56"));
    expect(formatBRL(0n)).toBe(nbsp("R$ 0,00"));
    expect(formatBRL(-5000n)).toBe(nbsp("-R$ 50,00"));
  });

  it("não perde precisão em valores grandes", () => {
    // 2^53 + 1 centavos: um number arredondaria o último dígito
    expect(formatBRL(9007199254740993n)).toBe(nbsp("R$ 90.071.992.547.409,93"));
  });
});

describe("digitsToCents", () => {
  it("empurra os dígitos da direita para a esquerda", () => {
    expect(digitsToCents("1")).toBe(1n);
    expect(digitsToCents("123")).toBe(123n);
    expect(digitsToCents("R$ 1.234,567")).toBe(1234567n);
  });

  it("ignora zeros à esquerda e tudo que não é dígito", () => {
    expect(digitsToCents("R$ 0,05")).toBe(5n);
    expect(digitsToCents("abc")).toBe(0n);
  });

  it("limita a 11 dígitos (R$ 999.999.999,99)", () => {
    expect(digitsToCents("123456789012345")).toBe(12345678901n);
  });
});

describe("appendDigits e dropLastDigit", () => {
  it("simulam a digitação numa maquininha", () => {
    let cents = 0n;
    for (const d of "4235") cents = appendDigits(cents, d);
    expect(cents).toBe(4235n);
    expect(dropLastDigit(cents)).toBe(423n);
    expect(dropLastDigit(0n)).toBe(0n);
  });

  it("não passa de 11 dígitos", () => {
    expect(appendDigits(99999999999n, "9")).toBe(99999999999n);
  });
});
