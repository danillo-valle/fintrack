import { describe, expect, it } from "vitest";
import {
  budgetFormSchema,
  budgetQuery,
  parseBudgetParams,
  parseShares,
  undoCopySchema,
} from "./schemas";

const CASA = "0199a8f0-0000-7000-8000-000000000001";
const MERCADO = "0199a8f0-0000-7000-8000-000000000002";
const today = "2026-10-09";

describe("parâmetros das telas do M08", () => {
  it("sem nada: mês de hoje, tudo que vejo, gráfico, 12 meses", () => {
    expect(parseBudgetParams({}, today)).toEqual({
      walletId: null,
      payer: null,
      month: "2026-10",
      view: "grafico",
      group: null,
      span: 12,
      detail: null,
    });
  });

  it("lixo na URL vira o padrão, nunca erro", () => {
    const parsed = parseBudgetParams(
      {
        mes: "2026-13",
        carteira: "1 OR 1=1",
        meses: "36",
        ver: "pizza",
        categoria: "x",
        detalhe: "ontem",
      },
      today,
    );
    expect(parsed).toMatchObject({
      month: "2026-10",
      walletId: null,
      span: 12,
      view: "grafico",
      group: null,
      detail: null,
    });
  });

  it("ida e volta: budgetQuery → parseBudgetParams dá o mesmo", () => {
    const parsed = parseBudgetParams(
      {
        mes: "2026-09",
        carteira: CASA,
        pago: "compartilhado",
        categoria: "sem",
        meses: "24",
        ver: "tabela",
        detalhe: "2026-11",
      },
      today,
    );
    const back = parseBudgetParams(
      Object.fromEntries(new URLSearchParams(budgetQuery(parsed).slice(1))),
      today,
    );
    expect(back).toEqual(parsed);
    expect(budgetQuery(parsed, { pago: null })).not.toContain("pago=");
  });
});

describe("formulário do orçado", () => {
  it("valor em reais vira centavos; vazio é zero (tira o orçado)", () => {
    const base = { walletId: CASA, month: "2026-10", categoryId: MERCADO };
    expect(budgetFormSchema.parse({ ...base, amount: "1400.00" })).toMatchObject({
      amount: 140000n,
      split: false,
    });
    expect(budgetFormSchema.parse(base)).toMatchObject({ amount: 0n });
    expect(budgetFormSchema.safeParse({ ...base, amount: "-1" }).success).toBe(false);
    expect(budgetFormSchema.safeParse({ ...base, amount: "1,5" }).success).toBe(false);
  });

  it("as partes: uma por pessoa, vazio é zero, nome inválido recusa", () => {
    expect(
      parseShares({ "parte:user_1": "600.00", "parte:compartilhado": "", outro: "1" }),
    ).toEqual([
      { payer: "user_1", cents: 60000n },
      { payer: "compartilhado", cents: 0n },
    ]);
    expect(parseShares({ "parte:": "1.00" })).toBe("Divisão inválida.");
    expect(typeof parseShares({ "parte:user_1": "abc" })).toBe("string");
  });

  it("desfazer a cópia: ids válidos, no máximo 500", () => {
    const ok = {
      walletId: CASA,
      month: "2026-10",
      categoryIds: `${MERCADO},${CASA}`,
      copiedAt: "2026-10-09T12:00:00.000Z",
    };
    expect(undoCopySchema.parse(ok).categoryIds).toHaveLength(2);
    expect(undoCopySchema.safeParse({ ...ok, categoryIds: "abc" }).success).toBe(false);
  });
});
