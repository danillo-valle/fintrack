// Testes de EXEMPLO do dinheiro: casos escolhidos a dedo, com o resultado escrito por extenso.
// Os testes de PROPRIEDADE (money.property.test.ts) complementam: lá, o fast-check gera
// milhares de casos aleatórios e confere regras que valem para qualquer valor.
import { describe, expect, it } from "vitest";
import {
  absCents,
  allocate,
  centsToDecimal,
  decimalToCents,
  fitsInColumn,
  installmentAmounts,
  MAX_ABS_CENTS,
  sumCents,
} from "./money";

describe("centsToDecimal e decimalToCents", () => {
  it.each([
    [0n, "0.00"],
    [1n, "0.01"],
    [-5n, "-0.05"],
    [123456n, "1234.56"],
    [MAX_ABS_CENTS, "999999999999.99"],
  ])("%s centavos ↔ %s", (cents, text) => {
    expect(centsToDecimal(cents)).toBe(text);
    expect(decimalToCents(text)).toBe(cents);
  });

  it("completa a casa que falta: '7' e '7.5'", () => {
    expect(decimalToCents("7")).toBe(700n);
    expect(decimalToCents("7.5")).toBe(750n);
  });

  it.each(["1.234,56", "12.345", "", "abc", "1e3", "--1"])("recusa %j", (text) => {
    expect(() => decimalToCents(text)).toThrow(/inválido/);
  });
});

describe("fitsInColumn: o limite do NUMERIC(14,2)", () => {
  it("aceita até R$ 999.999.999.999,99 nos dois sinais", () => {
    expect(fitsInColumn(MAX_ABS_CENTS)).toBe(true);
    expect(fitsInColumn(-MAX_ABS_CENTS)).toBe(true);
    expect(fitsInColumn(MAX_ABS_CENTS + 1n)).toBe(false);
  });
});

describe("sumCents e absCents", () => {
  it("soma exata, sem o erro do 0,1 + 0,2", () => {
    // Com number: 0.1 + 0.2 = 0.30000000000000004. Com centavos: 10 + 20 = 30.
    expect(sumCents([10n, 20n])).toBe(30n);
    expect(sumCents([])).toBe(0n);
    expect(sumCents([150000n, -4990n, -12345n])).toBe(132665n);
  });

  it("valor absoluto de bigint", () => {
    expect(absCents(-500n)).toBe(500n);
    expect(absCents(500n)).toBe(500n);
  });
});

describe("installmentAmounts: parcelas do cartão", () => {
  it("R$ 100,00 em 3x: a diferença vai para a 1ª", () => {
    expect(installmentAmounts(10000n, 3)).toEqual([3334n, 3333n, 3333n]);
  });

  it("R$ 100,00 em 6x: 4 centavos de sobra, todos na 1ª", () => {
    expect(installmentAmounts(10000n, 6)).toEqual([1670n, 1666n, 1666n, 1666n, 1666n, 1666n]);
  });

  it("gasto (negativo): o sinal acompanha todas as parcelas", () => {
    expect(installmentAmounts(-10000n, 3)).toEqual([-3334n, -3333n, -3333n]);
  });

  it("à vista é uma parcela só", () => {
    expect(installmentAmounts(4990n, 1)).toEqual([4990n]);
  });

  it.each([0, -1, 1.5, 100])("recusa %s parcelas", (count) => {
    expect(() => installmentAmounts(10000n, count)).toThrow(/parcelas/);
  });
});

describe("allocate: rateio pelo maior resto", () => {
  it("conta de R$ 100,00 dividida por três", () => {
    expect(allocate(10000n, [1n, 1n, 1n])).toEqual([3334n, 3333n, 3333n]);
  });

  it("aluguel 60/40 pela renda", () => {
    expect(allocate(250000n, [60n, 40n])).toEqual([150000n, 100000n]);
  });

  it("o centavo que sobra vai para a maior fração, não para o primeiro", () => {
    // 100 centavos em pesos 1:2:3 → cotas exatas 16,67 / 33,33 / 50,00
    // partes inteiras 16 + 33 + 50 = 99; sobra 1, que vai para a fração 0,67 (a 1ª)
    expect(allocate(100n, [1n, 2n, 3n])).toEqual([17n, 33n, 50n]);
    // 5 centavos em pesos 3:1 → 3,75 / 1,25 → 3 + 1 = 4; sobra 1 para o 0,75
    expect(allocate(5n, [3n, 1n])).toEqual([4n, 1n]);
  });

  it("peso zero recebe zero", () => {
    expect(allocate(1000n, [1n, 0n, 1n])).toEqual([500n, 0n, 500n]);
  });

  it("valor negativo: o sinal acompanha", () => {
    expect(allocate(-999n, [1n, 1n])).toEqual([-500n, -499n]);
  });

  it("porcentagem com casa decimal vira peso inteiro", () => {
    expect(allocate(10000n, [625n, 375n])).toEqual([6250n, 3750n]);
  });

  it("recusa pesos inválidos", () => {
    expect(() => allocate(100n, [])).toThrow(/pelo menos um/);
    expect(() => allocate(100n, [1n, -1n])).toThrow(/negativos/);
    expect(() => allocate(100n, [0n, 0n])).toThrow(/maior que zero/);
  });
});
