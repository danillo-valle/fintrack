import { describe, expect, it } from "vitest";
import { niceScale, percentOf } from "./chart";

describe("percentOf", () => {
  it("proporção com duas casas, presa entre 0 e 100", () => {
    expect(percentOf(48235n, 230000n)).toBe("20.97%");
    expect(percentOf(230000n, 230000n)).toBe("100%");
    expect(percentOf(999999n, 1n)).toBe("100%");
    expect(percentOf(-5n, 100n)).toBe("0%");
    expect(percentOf(5n, 0n)).toBe("0%");
  });
});

describe("niceScale", () => {
  it("marcas de 1; 2; 2,5 ou 5 × 10^n, com 5 marcas", () => {
    expect(niceScale(166143n)).toEqual({
      scale: 200000n,
      ticks: [200000n, 150000n, 100000n, 50000n, 0n],
    });
    expect(niceScale(845000n).scale).toBe(1000000n);
    expect(niceScale(0n).scale).toBe(10000n);
  });

  it("a escala sempre cobre o maior valor", () => {
    for (const max of [1n, 99n, 12345n, 166143n, 9_999_999_99n]) {
      expect(niceScale(max).scale >= max).toBe(true);
    }
  });
});
