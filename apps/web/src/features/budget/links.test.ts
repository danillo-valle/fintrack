import { describe, expect, it } from "vitest";
import { parseFilters } from "../transactions/schemas";
import { monthSpan, monthsSpan, monthToDate, statementSpan, transactionsHref } from "./links";

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
    const parsed = parseFilters(Object.fromEntries(new URLSearchParams(href.split("?")[1])), today);
    expect(parsed.walletId).toBe(CASA);
    expect(parsed.back).toBe(`/orcamento?mes=2026-10&carteira=${CASA}`);
    expect(parsed.filters).toEqual({
      from: "2026-10-01",
      to: "2026-10-09",
      accountId: null,
      categoryId: MERCADO,
      text: null,
      type: "expense",
      payer: { kind: "shared" },
      received: false,
      categorizedBy: null,
    });
  });

  it("pessoa e sem categoria", () => {
    const href = transactionsHref({ ...monthSpan("2026-09"), categoryId: "none", payer: "user_1" });
    const parsed = parseFilters(Object.fromEntries(new URLSearchParams(href.split("?")[1])), today);
    expect(parsed.filters.categoryId).toBe("none");
    expect(parsed.filters.payer).toEqual({ kind: "person", userId: "user_1" });
  });

  it("períodos: o mês inteiro, até hoje (só no mês de hoje) e vários meses", () => {
    expect(monthSpan("2026-02")).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    expect(monthToDate("2026-10", today)).toEqual({ from: "2026-10-01", to: "2026-10-09" });
    expect(monthToDate("2026-09", today)).toEqual({ from: "2026-09-01", to: "2026-09-30" });
    expect(monthsSpan("2026-04", "2026-09")).toEqual({ from: "2026-04-01", to: "2026-09-30" });
  });

  it("a fatura que vence no mês: do fechamento anterior à véspera do fechamento", () => {
    // Fecha 10, vence 17: a de outubro tem as compras de 10/09 a 09/10
    expect(statementSpan("2026-10", { closingDay: 10, dueDay: 17 })).toMatchObject({
      from: "2026-09-10",
      to: "2026-10-09",
      reference: "2026-10",
    });
    // Fecha 25, vence 5: a que vence em outubro fechou em setembro
    expect(statementSpan("2026-10", { closingDay: 25, dueDay: 5 })).toMatchObject({
      from: "2026-08-25",
      to: "2026-09-24",
      reference: "2026-09",
    });
  });
});
