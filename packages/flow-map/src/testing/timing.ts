// Para os testes de "não fica lento" (CodeQL js/polynomial-redos). Um limite de relógio depende
// da máquina: no CI, com tudo rodando junto, o mesmo código levou 8× mais que no laboratório e
// estourou os 300 ms. Aqui o tempo é comparado com o de uma passada simples pelo mesmo texto,
// medida na mesma hora, na mesma máquina: a máquina lenta deixa os dois lentos, e a razão fica.
// Medido no laboratório, parado e com a CPU ocupada: os leitores de uma passada ficam até ~2×;
// uma regex quadrática passa de 200× já com 30 mil repetições.

/** 100 mil repetições: o tamanho dos textos estranhos dos testes. */
export const HOSTILE = 100_000;

/** Até quantas vezes o tempo de uma passada simples pelo texto um leitor pode levar. */
export const MAX_COST = 25;

/** O menor de 3 tempos, em ms: tira a pausa do coletor de lixo ou de outra tarefa no meio. */
function best(run: () => unknown): number {
  let fastest = Number.POSITIVE_INFINITY;
  for (let i = 0; i < 3; i += 1) {
    const start = performance.now();
    run();
    fastest = Math.min(fastest, performance.now() - start);
  }
  return fastest;
}

/** Uma passada simples pelo texto: cada caractere lido e copiado uma vez. */
function onePass(text: string): string {
  return [...text].reverse().join("");
}

/**
 * Quantas vezes o tempo de `run` passa o de uma passada simples por `text`. Roda tudo uma vez
 * antes (o JIT não pesa só na primeira medida). Abaixo de 0,5 ms conta como 0,5 ms.
 */
export function cost(text: string, run: () => unknown): number {
  run();
  onePass(text);
  return (
    best(run) /
    Math.max(
      best(() => onePass(text)),
      0.5,
    )
  );
}
