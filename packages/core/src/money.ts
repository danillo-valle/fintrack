// Dinheiro no FinTrack: as regras puras, sem banco, sem tela, sem rede.
//
// Regra de ouro: dinheiro NUNCA é `number`. Um number guarda 0,1 + 0,2 como
// 0,30000000000000004 e perde o último dígito acima de 2^53. Aqui o valor vive em
// CENTAVOS como `bigint`: um inteiro exato, onde 10 centavos + 20 centavos = 30 centavos.
//
// Onde cada formato aparece:
//   memória (este pacote, a tela)  bigint em centavos ........ -123456n
//   bordas (formulário, JSON)      texto decimal ............. "-1234.56"
//   banco (coluna NUMERIC(14,2))   Prisma.Decimal ............ convertido em @fintrack/db
//
// Sinal: negativo é dinheiro que SAI (gasto, compra no cartão); positivo é dinheiro que ENTRA.

/** Valor monetário em centavos. É só um bigint com nome, para o código dizer o que é. */
export type Cents = bigint;

/**
 * Maior valor que a coluna NUMERIC(14,2) do banco guarda: 12 dígitos antes da vírgula e 2 depois,
 * ou seja, R$ 999.999.999.999,99 = 99.999.999.999.999 centavos.
 */
export const MAX_ABS_CENTS: Cents = 99_999_999_999_999n;

/** Converte centavos em texto decimal: -123456n → "-1234.56". */
export function centsToDecimal(cents: Cents): string {
  const negative = cents < 0n;
  const abs = negative ? -cents : cents;
  const units = abs / 100n; // divisão de bigint descarta a fração: 123456n / 100n = 1234n
  const rest = (abs % 100n).toString().padStart(2, "0"); // 123456n % 100n = 56n → "56"
  return `${negative ? "-" : ""}${units}.${rest}`;
}

/**
 * Converte texto decimal em centavos: "1234.5" → 123450n.
 * Aceita no máximo 2 casas: "12.345" é recusado em vez de arredondado em silêncio.
 * Aceita só ponto como separador: "1.234,56" é recusado (ambíguo).
 */
export function decimalToCents(value: string): Cents {
  const match = /^(-)?(\d+)(?:\.(\d{1,2}))?$/.exec(value.trim());
  if (!match) {
    throw new Error(`Valor monetário inválido: "${value}"`);
  }
  const [, sign, units = "0", fraction = ""] = match;
  const cents = BigInt(units) * 100n + BigInt(fraction.padEnd(2, "0"));
  return sign ? -cents : cents;
}

/** Confere se o valor cabe na coluna NUMERIC(14,2). Use antes de gravar valores calculados. */
export function fitsInColumn(cents: Cents): boolean {
  return cents >= -MAX_ABS_CENTS && cents <= MAX_ABS_CENTS;
}

/** Soma uma lista de valores: sumCents([1050n, -250n]) = 800n. Lista vazia soma 0n. */
export function sumCents(values: Iterable<Cents>): Cents {
  let total = 0n;
  for (const value of values) total += value;
  return total;
}

/** Valor absoluto: absCents(-500n) = 500n (Math.abs não aceita bigint). */
export function absCents(cents: Cents): Cents {
  return cents < 0n ? -cents : cents;
}

/**
 * Divide uma compra parcelada em `count` parcelas, como os cartões brasileiros fazem:
 * todas iguais, e a diferença de centavos que sobra da divisão vai para a PRIMEIRA parcela.
 *
 *   installmentAmounts(10000n, 3)  → [3334n, 3333n, 3333n]      (R$ 100,00 em 3x)
 *   installmentAmounts(-10000n, 6) → [-1670n, -1666n, ...]      (gasto: o sinal acompanha)
 *
 * Garantias (provadas pelos testes de propriedade): a soma é sempre o total; da 2ª em
 * diante são todas iguais; a 1ª é maior ou igual às outras em valor absoluto.
 */
export function installmentAmounts(total: Cents, count: number): Cents[] {
  if (!Number.isInteger(count) || count < 1 || count > 99) {
    throw new Error(`Número de parcelas inválido: ${count} (de 1 a 99)`);
  }
  const n = BigInt(count);
  const sign = total < 0n ? -1n : 1n;
  const abs = absCents(total);
  const base = abs / n; // parte inteira de cada parcela
  const remainder = abs - base * n; // centavos que sobraram da divisão (0 até n-1)
  return Array.from({ length: count }, (_, i) => sign * (i === 0 ? base + remainder : base));
}

/**
 * Rateio: reparte um valor entre várias partes, proporcional aos pesos, sem perder centavo.
 * Usa o método do maior resto (Hamilton): cada parte recebe a parte inteira da sua cota e os
 * centavos que sobram vão, um a um, para as partes com a maior fração descartada.
 * Empate de fração: ganha quem vem antes na lista (resultado sempre o mesmo).
 *
 *   allocate(10000n, [1n, 1n, 1n])  → [3334n, 3333n, 3333n]   (conta de R$ 100,00 em três)
 *   allocate(10000n, [60n, 40n])    → [6000n, 4000n]          (aluguel 60/40 pela renda)
 *   allocate(-999n, [1n, 1n])       → [-500n, -499n]          (o sinal acompanha o total)
 *
 * Os pesos são inteiros (bigint) maiores ou iguais a zero, com soma positiva.
 * Para porcentagens com casas decimais, multiplique: 62,5% / 37,5% → [625n, 375n].
 */
export function allocate(total: Cents, weights: readonly bigint[]): Cents[] {
  if (weights.length === 0) throw new Error("O rateio precisa de pelo menos um peso");
  if (weights.some((w) => w < 0n)) throw new Error("Pesos do rateio não podem ser negativos");
  const weightSum = sumCents(weights);
  if (weightSum === 0n) throw new Error("A soma dos pesos do rateio precisa ser maior que zero");

  const sign = total < 0n ? -1n : 1n;
  const abs = absCents(total);

  // Cota exata de cada parte = abs * peso / soma. Guardamos a parte inteira e o "resto"
  // da divisão, que mede a fração descartada (comparar restos = comparar frações).
  const shares = weights.map((weight, index) => {
    const scaled = abs * weight;
    return { index, floor: scaled / weightSum, remainder: scaled % weightSum };
  });

  // Quantos centavos sobraram depois de dar a parte inteira a todo mundo
  let leftover = abs - sumCents(shares.map((s) => s.floor));

  // Maior resto primeiro; empate fica com quem veio antes
  const byRemainder = [...shares].sort((a, b) =>
    a.remainder === b.remainder ? a.index - b.index : a.remainder > b.remainder ? -1 : 1,
  );
  const result = shares.map((s) => s.floor);
  for (const share of byRemainder) {
    if (leftover === 0n) break;
    result[share.index] = (result[share.index] ?? 0n) + 1n;
    leftover -= 1n;
  }
  return result.map((value) => sign * value);
}
