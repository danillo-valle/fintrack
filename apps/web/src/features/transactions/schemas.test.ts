// Schemas de lançamento e filtros da URL (M07): casos válidos e o que só chega editando o HTML
// ou a URL (forma de pagamento inventada, valor negativo, id fora do formato).
import { describe, expect, it } from "vitest";
import {
  exportSchema,
  filtersToQuery,
  parseFilters,
  recurrenceSchema,
  transactionSchema,
  transferSchema,
} from "./schemas";

const ID = "0199b5c2-7d0e-7a3b-8c1d-2e3f4a5b6c7d";
const ID2 = "0199b5c2-7d0e-7a3b-8c1d-2e3f4a5b6c7e";
const base = {
  kind: "expense",
  amount: "42.35",
  description: "  Mercado  ",
  occurredOn: "2026-10-07",
  walletId: ID,
  accountId: ID2,
};

describe("transactionSchema", () => {
  it("válido: valor em centavos, descrição sem espaços nas pontas, opcionais nulos", () => {
    const parsed = transactionSchema.parse(base);
    expect(parsed).toMatchObject({
      amount: 4235n,
      description: "Mercado",
      categoryId: null,
      method: null,
      cardId: null,
      notes: null,
      rememberRule: false,
    });
  });

  it("'sempre categorizar assim' marcado", () => {
    expect(transactionSchema.parse({ ...base, rememberRule: "on" }).rememberRule).toBe(true);
  });

  it.each([
    [{ amount: "0.00" }, "Informe um valor maior que zero."],
    [{ amount: "-10.00" }, "Informe um valor maior que zero."],
    [{ amount: "10,00" }, "Informe um valor maior que zero."],
    [{ amount: "12.345" }, "Informe um valor maior que zero."],
    [{ description: "   " }, "Descreva o lançamento, por exemplo: Mercado."],
    [{ occurredOn: "2026-02-30" }, "Use uma data válida."],
    [{ walletId: "nao-e-id" }, "Escolha a carteira."],
    [{ method: "BITCOIN" }, null],
    [{ kind: "doacao" }, "Escolha despesa ou receita."],
    [{ categoryId: "1 OR 1=1" }, null],
  ])("recusa %j", (over, message) => {
    const result = transactionSchema.safeParse({ ...base, ...over });
    expect(result.success).toBe(false);
    if (message && !result.success) expect(result.error.issues[0]?.message).toBe(message);
  });
});

describe("transferSchema", () => {
  const transfer = {
    fromAccountId: ID,
    toAccountId: ID2,
    amount: "1500.00",
    occurredOn: "2026-10-09",
  };

  it("descrição padrão e forma padrão", () => {
    expect(transferSchema.parse(transfer)).toMatchObject({
      amount: 150000n,
      description: "Transferência",
      method: "TRANSFER",
    });
  });

  it("recusa a mesma conta e crédito como forma", () => {
    expect(transferSchema.safeParse({ ...transfer, toAccountId: ID }).success).toBe(false);
    expect(transferSchema.safeParse({ ...transfer, method: "CREDIT" }).success).toBe(false);
  });
});

describe("recurrenceSchema", () => {
  const rec = {
    kind: "FIXED_BILL",
    description: "Aluguel",
    amount: "2500.00",
    dayOfMonth: "31",
    startsOn: "2026-01-01",
    walletId: ID,
    accountId: ID2,
  };

  it("dia vira número; fim vazio vira null", () => {
    expect(recurrenceSchema.parse(rec)).toMatchObject({ dayOfMonth: 31, endsOn: null });
  });

  it.each([
    { dayOfMonth: "0" },
    { dayOfMonth: "32" },
    { dayOfMonth: "dez" },
    { endsOn: "2025-12-31" },
  ])("recusa %j", (over) => {
    expect(recurrenceSchema.safeParse({ ...rec, ...over }).success).toBe(false);
  });
});

describe("filtros na URL", () => {
  const today = "2026-10-07";

  it("sem nada: o mês de hoje", () => {
    expect(parseFilters({}, today)).toEqual({
      filters: {
        from: "2026-10-01",
        to: "2026-10-31",
        accountId: null,
        categoryId: null,
        text: null,
        type: null,
      },
      walletId: null,
      cursor: null,
    });
  });

  it("lê os nomes em português", () => {
    const parsed = parseFilters(
      {
        de: "2026-09-01",
        ate: "2026-09-30",
        carteira: ID,
        conta: ID2,
        categoria: "sem",
        q: " mercado ",
        tipo: "despesa",
      },
      today,
    );
    expect(parsed.filters).toEqual({
      from: "2026-09-01",
      to: "2026-09-30",
      accountId: ID2,
      categoryId: "none",
      text: "mercado",
      type: "expense",
    });
    expect(parsed.walletId).toBe(ID);
  });

  it("lixo na URL vira o padrão, nunca erro", () => {
    const parsed = parseFilters(
      { de: "ontem", ate: "2026-13-01", carteira: "1 OR 1=1", tipo: "tudo", q: "x".repeat(500) },
      today,
    );
    expect(parsed.filters.from).toBe("2026-10-01");
    expect(parsed.filters.to).toBe("2026-10-31");
    expect(parsed.walletId).toBeNull();
    expect(parsed.filters.type).toBeNull();
    expect(parsed.filters.text).toHaveLength(100);
  });

  it("período invertido é desvirado", () => {
    const parsed = parseFilters({ de: "2026-10-31", ate: "2026-10-01" }, today);
    expect([parsed.filters.from, parsed.filters.to]).toEqual(["2026-10-01", "2026-10-31"]);
  });

  it("ida e volta: filtersToQuery → parseFilters dá o mesmo", () => {
    const parsed = parseFilters(
      {
        de: "2026-09-01",
        ate: "2026-09-30",
        carteira: ID,
        categoria: ID2,
        q: "pão",
        tipo: "transferencia",
      },
      today,
    );
    const back = parseFilters(
      Object.fromEntries(new URLSearchParams(filtersToQuery(parsed))),
      today,
    );
    expect(back.filters).toEqual(parsed.filters);
    expect(back.walletId).toBe(parsed.walletId);
  });

  it("filtersToQuery acrescenta o cursor da próxima página", () => {
    const parsed = parseFilters({}, today);
    expect(filtersToQuery(parsed, { cursor: `2026-10-07_${ID}` })).toContain("cursor=2026-10-07_");
  });
});

describe("exportSchema", () => {
  it("carteira obrigatória e datas válidas", () => {
    expect(
      exportSchema.safeParse({ walletId: ID, from: "2026-10-01", to: "2026-10-31" }).success,
    ).toBe(true);
    expect(
      exportSchema.safeParse({ walletId: "", from: "2026-10-01", to: "2026-10-31" }).success,
    ).toBe(false);
  });
});
