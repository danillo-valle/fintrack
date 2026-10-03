// Gerador de números aleatórios COM SEMENTE (mulberry32).
//
// Math.random() dá um resultado diferente a cada execução; aqui, a mesma semente gera
// sempre a mesma sequência. Por isso o seed é reprodutível: rodar duas vezes cria os mesmos
// lançamentos, e um teste pode conferir totais exatos. Não serve para segredo nem senha
// (para isso existe crypto.randomUUID), só para dados de exemplo.
import type { Cents } from "@fintrack/core";

export type Random = ReturnType<typeof createRandom>;

export function createRandom(seed: number) {
  let state = seed >>> 0; // ">>> 0" força um inteiro de 32 bits sem sinal

  /** Próximo número entre 0 (inclusive) e 1 (exclusive), como o Math.random. */
  function next(): number {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  return {
    next,

    /** Inteiro entre min e max, inclusive. */
    int(min: number, max: number): number {
      return min + Math.floor(next() * (max - min + 1));
    },

    /**
     * Valor em centavos entre min e max, inclusive, sem passar dinheiro por number:
     * sorteia um inteiro de 32 bits e faz a conta toda em bigint.
     */
    cents(min: Cents, max: Cents): Cents {
      const span = max - min + 1n;
      const r = BigInt(Math.floor(next() * 4294967296)); // de 0 a 2^32 - 1
      return min + ((r * span) >> 32n); // ">> 32n" = dividir por 2^32
    },

    /** Um item qualquer da lista. */
    pick<T>(items: readonly T[]): T {
      const item = items[Math.floor(next() * items.length)];
      if (item === undefined) throw new Error("pick() com lista vazia");
      return item;
    },

    /** true com probabilidade p (de 0 a 1). */
    chance(p: number): boolean {
      return next() < p;
    },
  };
}
