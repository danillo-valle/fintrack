// Testes de PROPRIEDADE do dinheiro, com o fast-check.
//
// Em vez de escolher 5 exemplos, descrevemos uma regra que vale para QUALQUER entrada
// ("as parcelas sempre somam o total") e o fast-check gera centenas de entradas aleatórias
// para tentar quebrá-la, incluindo as chatas: zero, negativos, valores enormes, 1 parcela.
// Quando acha um caso que falha, ele ENCOLHE o caso até o menor exemplo que ainda falha
// (shrinking) e mostra a "seed" para você repetir exatamente o mesmo teste.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  absCents,
  allocate,
  centsToDecimal,
  decimalToCents,
  installmentAmounts,
  MAX_ABS_CENTS,
  sumCents,
} from "./money";

/** Qualquer valor que cabe na coluna NUMERIC(14,2), positivo ou negativo. */
const anyCents = fc.bigInt({ min: -MAX_ABS_CENTS, max: MAX_ABS_CENTS });
/** Número de parcelas de 1 a 48 (o maior parcelamento comum no Brasil). */
const anyCount = fc.integer({ min: 1, max: 48 });
/** Lista de 1 a 10 pesos inteiros, com pelo menos um maior que zero. */
const anyWeights = fc
  .array(fc.bigInt({ min: 0n, max: 1_000_000n }), { minLength: 1, maxLength: 10 })
  .filter((weights) => weights.some((w) => w > 0n));

describe("propriedades da conversão", () => {
  it("ida e volta não muda o valor (para qualquer valor)", () => {
    fc.assert(
      fc.property(anyCents, (cents) => {
        expect(decimalToCents(centsToDecimal(cents))).toBe(cents);
      }),
    );
  });

  it("o texto sempre tem exatamente 2 casas decimais", () => {
    fc.assert(
      fc.property(anyCents, (cents) => {
        expect(centsToDecimal(cents)).toMatch(/^-?\d+\.\d{2}$/);
      }),
    );
  });
});

describe("propriedades das parcelas", () => {
  it("as parcelas sempre somam o total, ao centavo", () => {
    fc.assert(
      fc.property(anyCents, anyCount, (total, count) => {
        expect(sumCents(installmentAmounts(total, count))).toBe(total);
      }),
    );
  });

  it("da 2ª parcela em diante são todas iguais", () => {
    fc.assert(
      fc.property(anyCents, anyCount, (total, count) => {
        const rest = installmentAmounts(total, count).slice(1);
        expect(new Set(rest).size).toBeLessThanOrEqual(1);
      }),
    );
  });

  it("a 1ª é a maior, e passa das outras em menos centavos do que o número de parcelas", () => {
    fc.assert(
      fc.property(anyCents, anyCount, (total, count) => {
        const [first = 0n, second = first] = installmentAmounts(total, count);
        const diff = absCents(first) - absCents(second);
        expect(diff >= 0n && diff < BigInt(count)).toBe(true);
      }),
    );
  });

  it("parcelar um gasto é o espelho de parcelar uma receita", () => {
    fc.assert(
      fc.property(anyCents, anyCount, (total, count) => {
        const mirrored = installmentAmounts(-total, count).map((value) => -value);
        expect(mirrored).toEqual(installmentAmounts(total, count));
      }),
    );
  });
});

describe("propriedades do rateio", () => {
  it("as partes sempre somam o total", () => {
    fc.assert(
      fc.property(anyCents, anyWeights, (total, weights) => {
        expect(sumCents(allocate(total, weights))).toBe(total);
      }),
    );
  });

  it("cada parte fica a menos de 1 centavo da cota exata", () => {
    fc.assert(
      fc.property(anyCents, anyWeights, (total, weights) => {
        const weightSum = sumCents(weights);
        allocate(total, weights).forEach((share, i) => {
          // |parte - total*peso/soma| < 1  ⇔  |parte*soma - total*peso| < soma (só inteiros)
          const error = absCents(share * weightSum - total * (weights[i] ?? 0n));
          expect(error < weightSum).toBe(true);
        });
      }),
    );
  });

  it("peso zero sempre recebe zero", () => {
    fc.assert(
      fc.property(anyCents, anyWeights, (total, weights) => {
        allocate(total, [...weights, 0n])
          .slice(-1)
          .forEach((share) => {
            expect(share).toBe(0n);
          });
      }),
    );
  });

  it("pesos multiplicados pelo mesmo fator dão o mesmo rateio (60/40 = 6/4 = 3/2)", () => {
    fc.assert(
      fc.property(anyCents, anyWeights, fc.bigInt({ min: 1n, max: 100n }), (total, weights, k) => {
        expect(
          allocate(
            total,
            weights.map((w) => w * k),
          ),
        ).toEqual(allocate(total, weights));
      }),
    );
  });
});
