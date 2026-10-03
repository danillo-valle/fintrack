// Testes da ponte Decimal ⇄ centavos. Não precisam de banco: Prisma.Decimal é só uma classe.
import { MAX_ABS_CENTS } from "@fintrack/core";
import { describe, expect, it } from "vitest";
import { Prisma } from "./generated/prisma/client";
import { fromDbDecimal, fromDbDecimalOrNull, toDbDecimal } from "./money";

describe("toDbDecimal e fromDbDecimal", () => {
  it.each([0n, 1n, -1n, 123456n, -4990n, MAX_ABS_CENTS, -MAX_ABS_CENTS])(
    "%s centavos vão e voltam iguais",
    (cents) => {
      expect(fromDbDecimal(toDbDecimal(cents))).toBe(cents);
    },
  );

  it("grava o texto exato, sem passar por number", () => {
    expect(toDbDecimal(-123456n).toString()).toBe("-1234.56");
    expect(toDbDecimal(10n).toString()).toBe("0.1");
  });

  it("lê o que o banco devolve (Decimal com ou sem casas)", () => {
    expect(fromDbDecimal(new Prisma.Decimal("1234.5"))).toBe(123450n);
    expect(fromDbDecimal(new Prisma.Decimal("7"))).toBe(700n);
  });

  it("recusa valor que não cabe na coluna NUMERIC(14,2)", () => {
    expect(() => toDbDecimal(MAX_ABS_CENTS + 1n)).toThrow(/limite/);
  });

  it("null continua null", () => {
    expect(fromDbDecimalOrNull(null)).toBeNull();
    expect(fromDbDecimalOrNull(new Prisma.Decimal("0.01"))).toBe(1n);
  });
});
