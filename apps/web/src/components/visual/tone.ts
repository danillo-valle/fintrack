import type { Tone } from "./icon-tile";

// Cor estável para uma coisa com id (categoria, carteira): o mesmo id dá sempre a mesma cor,
// em qualquer tela e em qualquer aparelho, sem guardar nada no banco.
export function toneFor(id: string | null | undefined): Tone {
  if (!id) return "neutral";
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return ((hash % 5) + 1) as Tone;
}
