// Para os testes de "não fica lento": um tamanho de texto que deixa uma regex com repetição sem
// âncora lenta por segundos (o CodeQL acusa como js/polynomial-redos), e o relógio de uma chamada.

/** 100 mil repetições: o que passa pelo texto uma vez leva milissegundos; o quadrático, segundos. */
export const HOSTILE = 100_000;

/** Quanto uma chamada levou, em ms. Linear passa de longe em 300 ms, mesmo numa máquina lenta. */
export function timed(run: () => unknown): number {
  const start = performance.now();
  run();
  return performance.now() - start;
}
