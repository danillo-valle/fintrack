// Os endereços do app, pedaço por pedaço ("/carteiras/[walletId]" = "carteiras" e "[walletId]").
// Sem expressão regular sobre o endereço: cada função passa pelo texto uma vez só, então nenhum
// endereço estranho (muitos "[" sem "]", por exemplo) a deixa lenta (CodeQL js/polynomial-redos).

/** "[walletId]", "[...slug]" e o "[…]" dos links montados: o pedaço que muda. */
export function isDynamicSegment(segment: string): boolean {
  return segment.length > 2 && segment.startsWith("[") && segment.endsWith("]");
}

/**
 * O nome do parâmetro de um pedaço variável: "[walletId]" → "walletId", "[...slug]" e
 * "[[...slug]]" (o opcional do Next) → "slug". O "[…]" de um link não tem nome: null.
 */
export function segmentParam(segment: string): string | null {
  if (!isDynamicSegment(segment)) return null;
  let inner = segment.slice(1, -1);
  if (inner.length > 2 && inner.startsWith("[") && inner.endsWith("]")) inner = inner.slice(1, -1);
  const name = inner.startsWith("...") ? inner.slice(3) : inner;
  if (name === "" || name === "…" || name.includes("[") || name.includes("]")) return null;
  return name;
}

/** Os parâmetros de uma rota, na ordem: "/x/[id]/y/[...slug]" → ["id", "slug"]. */
export function routeParams(route: string): string[] {
  return route
    .split("/")
    .map(segmentParam)
    .filter((name): name is string => name !== null);
}

/**
 * Um link leva a esta rota? "/carteiras/[walletId]" casa com "/carteiras/abc" e com o molde
 * "/carteiras/[…]" (um link montado com uma parte variável); cada pedaço fixo tem de ser igual.
 */
export function routeMatches(route: string, link: string): boolean {
  const want = route.split("/");
  const got = link.split("/");
  if (want.length !== got.length) return false;
  return want.every((segment, i) => {
    const other = got[i] as string;
    return isDynamicSegment(segment) ? other !== "" : segment === other;
  });
}
