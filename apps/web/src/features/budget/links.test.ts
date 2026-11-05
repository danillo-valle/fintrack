import { describe, expect, it } from "vitest";
import { parseFilters } from "../transactions/schemas";
import { monthSpan, monthsSpan, monthToDate, transactionsHref } from "./links";

/** Os parâmetros de um endereço, com os repetidos (mes, pago) como lista. */
const paramsOf = (href: string) => {
  const result: Record<string, string | string[]> = {};
  for (const [key, value] of new URLSearchParams(href.split("?")[1])) {
    const current = result[key];
    result[key] = current === undefined ? value : [current, value].flat();
  }
  return result;
};

const CASA = "0199a8f0-0000-7000-8000-000000000001";
const MERCADO = "0199a8f0-0000-7000-8000-000000000002";
const today = "2026-10-09";

describe("o caminho de cada número até a lista (M08)", () => {
  it("a lista lê exatamente os filtros que o painel escreveu", () => {
    const href = transactionsHref({
      ...monthToDate("2026-10", today),
      walletId: CASA,
      categoryId: MERCADO,
      payer: "compartilhado",
      type: "expense",
      back: `/orcamento?mes=2026-10&carteira=${CASA}`,
    });
    expect(href.startsWith("/lancamentos?")).toBe(true);
    const parsed = parseFilters(paramsOf(href), today);
    expect(parsed.walletId).toBe(CASA);
    expect(parsed.back).toBe(`/orcamento?mes=2026-10&carteira=${CASA}`);
    expect(parsed.filters).toEqual({
      period: { kind: "range", from: "2026-10-01", to: "2026-10-31" },
      upTo: "2026-10-09",
      accountId: null,
      categoryId: MERCADO,
      text: null,
      type: "expense",
      payers: [{ kind: "shared" }],
      received: false,
      categorizedBy: null,
    });
  });

  it("pessoa e sem categoria", () => {
    const href = transactionsHref({ ...monthSpan("2026-09"), categoryId: "none", payer: "user_1" });
    const parsed = parseFilters(paramsOf(href), today);
    expect(parsed.filters.categoryId).toBe("none");
    expect(parsed.filters.payers).toEqual([{ kind: "person", userId: "user_1" }]);
  });

  it("períodos: o mês inteiro, até hoje (só no mês de hoje) e vários meses", () => {
    expect(monthSpan("2026-02")).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    // Até hoje: o mês inteiro pela data de caixa, só com o que já aconteceu (M13.3a)
    expect(monthToDate("2026-10", today)).toEqual({
      from: "2026-10-01",
      to: "2026-10-31",
      upTo: "2026-10-09",
    });
    expect(monthToDate("2026-09", today)).toEqual({ from: "2026-09-01", to: "2026-09-30" });
    expect(monthsSpan("2026-04", "2026-09")).toEqual({ from: "2026-04-01", to: "2026-09-30" });
  });
});
