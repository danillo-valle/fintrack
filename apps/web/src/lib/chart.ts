// Geometria dos gráficos do M08: quanto de uma barra cada valor ocupa.
//
// Dinheiro continua bigint (centavos). O que vira number aqui é só a PROPORÇÃO na tela (uma
// largura em %), calculada em bigint até o fim e convertida com duas casas.

/** `value` como porcentagem de `scale` ("42.18%"), presa entre 0 e 100. Escala zero: "0%". */
export function percentOf(value: bigint, scale: bigint): string {
  if (scale <= 0n || value <= 0n) return "0%";
  const basisPoints = (value * 10000n) / scale; // centésimos de ponto percentual
  const clamped = basisPoints > 10000n ? 10000n : basisPoints;
  return `${(Number(clamped) / 100).toString()}%`;
}

/**
 * Uma escala "redonda" para o eixo: marcas de 1; 2; 2,5 ou 5 × 10^n, e a de cima acima do maior
 * valor. maxCents 1661_43 → 2000_00. Devolve a escala e as 5 marcas da grade, de cima para baixo.
 */
export function niceScale(maxCents: bigint): { scale: bigint; ticks: bigint[] } {
  if (maxCents <= 0n) return { scale: 100_00n, ticks: [100_00n, 75_00n, 50_00n, 25_00n, 0n] };
  let step = 1_00n; // R$ 1
  for (;;) {
    for (const m of [10n, 20n, 25n, 50n]) {
      const candidate = (step * m) / 10n;
      if (candidate * 4n >= maxCents) {
        const scale = candidate * 4n;
        return { scale, ticks: [4n, 3n, 2n, 1n, 0n].map((k) => candidate * k) };
      }
    }
    step *= 10n;
  }
}
