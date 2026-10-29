import { describe, expect, it } from "vitest";
import { isDynamicSegment, routeMatches, routeParams, segmentParam } from "./routes";
import { cost, HOSTILE, MAX_COST } from "./testing/timing";

describe("os endereços do app, pedaço por pedaço", () => {
  it("lê os parâmetros: simples, pega-tudo e pega-tudo opcional", () => {
    expect(routeParams("/carteiras/[walletId]")).toEqual(["walletId"]);
    expect(routeParams("/a/[id]/b/[...slug]")).toEqual(["id", "slug"]);
    expect(routeParams("/docs/[[...slug]]")).toEqual(["slug"]);
    expect(routeParams("/ajustes")).toEqual([]);
    expect(segmentParam("[…]")).toBeNull();
    expect(isDynamicSegment("[]")).toBe(false);
  });

  it("casa um link com a rota: pedaço fixo igual, pedaço variável com qualquer valor", () => {
    expect(routeMatches("/x/[id]", "/x/abc")).toBe(true);
    expect(routeMatches("/x/[id]", "/x/[…]")).toBe(true);
    expect(routeMatches("/x/[id]", "/x/abc/y")).toBe(false);
    expect(routeMatches("/x/[id]", "/x/")).toBe(false);
    expect(routeMatches("/x/novo", "/x/[…]")).toBe(false);
    expect(routeMatches("/a.b", "/axb")).toBe(false);
    expect(routeMatches("/", "/")).toBe(true);
  });

  it("não fica lento com um endereço estranho (muitos [ sem ], CodeQL js/polynomial-redos)", () => {
    const route = "/" + "[\\".repeat(HOSTILE);
    const link = "/" + "[".repeat(HOSTILE);
    expect(cost(route, () => routeParams(route))).toBeLessThan(MAX_COST);
    expect(cost(route, () => routeMatches(route, link))).toBeLessThan(MAX_COST);
  });
});
