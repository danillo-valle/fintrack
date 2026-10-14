import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { compareCivil } from "./dates";
import {
  civilFromProviderTimestamp,
  importChanges,
  importWalletFor,
  importedDescription,
  importedMethod,
  importWindow,
  lastFourOf,
  openStatementWindow,
  settlementCheck,
  statementForDueDate,
  suggestAccountLink,
  type ImportedFields,
  type LinkCandidate,
} from "./sync";

describe("civilFromProviderTimestamp", () => {
  it("meia-noite UTC em ponto é só o dia: não volta para o dia anterior", () => {
    expect(civilFromProviderTimestamp("2026-10-09T00:00:00.000Z")).toBe("2026-10-09");
    expect(civilFromProviderTimestamp("2026-10-01T00:00:00Z")).toBe("2026-10-01");
  });

  it("horário de verdade vira o dia de São Paulo", () => {
    expect(civilFromProviderTimestamp("2026-10-09T01:30:00.000Z")).toBe("2026-10-08");
    expect(civilFromProviderTimestamp("2026-10-09T15:00:00.000Z")).toBe("2026-10-09");
  });

  it("aceita só a data e recusa texto que não é data", () => {
    expect(civilFromProviderTimestamp("2026-10-09")).toBe("2026-10-09");
    expect(() => civilFromProviderTimestamp("ontem")).toThrow(/inválida/);
  });
});

describe("importWindow", () => {
  it("primeira vez: da data de corte até hoje", () => {
    expect(
      importWindow({ importFrom: "2026-10-01", lastSyncedOn: null, today: "2026-10-10" }),
    ).toEqual({
      from: "2026-10-01",
      to: "2026-10-10",
    });
  });

  it("depois: relê os últimos 40 dias, nunca antes da data de corte", () => {
    expect(
      importWindow({ importFrom: "2026-01-01", lastSyncedOn: "2026-10-10", today: "2026-10-11" }),
    ).toEqual({ from: "2026-08-31", to: "2026-10-11" });
    expect(
      importWindow({ importFrom: "2026-10-01", lastSyncedOn: "2026-10-10", today: "2026-10-11" }),
    ).toEqual({ from: "2026-10-01", to: "2026-10-11" });
  });

  it("propriedade: o período nunca começa antes da data de corte nem termina depois de hoje", () => {
    const day = fc.integer({ min: 0, max: 900 }).map((n) => {
      const d = new Date(Date.UTC(2025, 0, 1 + n));
      return d.toISOString().slice(0, 10);
    });
    fc.assert(
      fc.property(day, fc.option(day, { nil: null }), day, (importFrom, last, today) => {
        const w = importWindow({ importFrom, lastSyncedOn: last, today });
        expect(compareCivil(w.from, importFrom)).toBeGreaterThanOrEqual(0);
        expect(compareCivil(w.from, w.to)).toBeLessThanOrEqual(0);
      }),
    );
  });
});

describe("importedMethod", () => {
  it("cartão é sempre crédito; conta corrente segue o banco ou o sinal", () => {
    expect(importedMethod("CREDIT_CARD", null, -1000n)).toBe("CREDIT");
    expect(importedMethod("CREDIT_CARD", "PIX", 1000n)).toBe("CREDIT");
    expect(importedMethod("CHECKING", "PIX", -1000n)).toBe("PIX");
    expect(importedMethod("CHECKING", "BOLETO", -1000n)).toBe("BOLETO");
    expect(importedMethod("CHECKING", null, -1000n)).toBe("DEBIT");
    expect(importedMethod("SAVINGS", null, 1000n)).toBe("DEPOSIT");
  });
});

describe("statementForDueDate", () => {
  const cycle = { closingDay: 27, dueDay: 5 };

  it("acha a fatura do ciclo cadastrado pelo vencimento", () => {
    expect(statementForDueDate("2026-10-05", cycle)).toEqual({
      referenceMonth: "2026-09",
      closingDate: "2026-09-27",
      dueDate: "2026-10-05",
    });
  });

  it("ciclo que fecha e vence no mesmo mês", () => {
    expect(statementForDueDate("2026-10-10", { closingDay: 2, dueDay: 10 })).toEqual({
      referenceMonth: "2026-10",
      closingDate: "2026-10-02",
      dueDate: "2026-10-10",
    });
  });

  it("banco mudou o vencimento: fica com o último fechamento antes dele", () => {
    expect(statementForDueDate("2026-10-08", cycle)).toEqual({
      referenceMonth: "2026-09",
      closingDate: "2026-09-27",
      dueDate: "2026-10-08",
    });
  });

  it("sem ciclo: usa o fechamento do banco ou o vencimento menos 10 dias", () => {
    expect(statementForDueDate("2026-10-05", null, "2026-09-26").closingDate).toBe("2026-09-26");
    expect(statementForDueDate("2026-10-05", null).closingDate).toBe("2026-09-25");
  });
});

describe("openStatementWindow", () => {
  it("com as datas do banco", () => {
    expect(
      openStatementWindow({
        today: "2026-10-10",
        cycle: { closingDay: 27, dueDay: 5 },
        bankCloseDate: "2026-10-27",
        bankDueDate: "2026-11-05",
      }),
    ).toEqual({
      referenceMonth: "2026-10",
      closingDate: "2026-10-27",
      dueDate: "2026-11-05",
      from: "2026-09-27",
      to: "2026-10-26",
    });
  });

  it("só com o ciclo cadastrado, e sem nada não há como saber", () => {
    expect(
      openStatementWindow({ today: "2026-10-10", cycle: { closingDay: 27, dueDay: 5 } }),
    ).toMatchObject({
      closingDate: "2026-10-27",
      from: "2026-09-27",
      to: "2026-10-26",
    });
    expect(openStatementWindow({ today: "2026-10-10", cycle: null })).toBeNull();
  });

  it("fechamento do banco já passou: volta para o ciclo cadastrado", () => {
    expect(
      openStatementWindow({
        today: "2026-10-28",
        cycle: { closingDay: 27, dueDay: 5 },
        bankCloseDate: "2026-10-27",
        bankDueDate: "2026-11-05",
      }),
    ).toMatchObject({ closingDate: "2026-11-27", from: "2026-10-27" });
  });
});

describe("settlementCheck", () => {
  it("compras + IOF = total do banco (o exemplo do desenho)", () => {
    const r = settlementCheck({ total: 214635n, charges: [412n], purchases: [-200000n, -14223n] });
    expect(r).toEqual({ expected: 214635n, found: 214635n, difference: 0n, matches: true });
  });

  it("estorno reduz o valor; faltando compra, mostra a diferença", () => {
    expect(
      settlementCheck({ total: 9000n, charges: [], purchases: [-10000n, 1000n] }).matches,
    ).toBe(true);
    expect(settlementCheck({ total: 10000n, charges: [], purchases: [-9000n] })).toMatchObject({
      matches: false,
      difference: 1000n,
    });
  });

  it("propriedade: o total feito das próprias compras e encargos sempre confere", () => {
    fc.assert(
      fc.property(
        fc.array(fc.bigInt({ min: -500000n, max: 500000n })),
        fc.array(fc.bigInt({ min: 0n, max: 10000n })),
        (purchases, charges) => {
          const total =
            -purchases.reduce((a, b) => a + b, 0n) + charges.reduce((a, b) => a + b, 0n);
          expect(settlementCheck({ total, charges, purchases }).matches).toBe(true);
        },
      ),
    );
  });
});

describe("lastFourOf e suggestAccountLink", () => {
  it("lê o final de números mascarados", () => {
    expect(lastFourOf("****0001")).toBe("0001");
    expect(lastFourOf("5502 **** **** 0002")).toBe("0002");
    expect(lastFourOf("12")).toBeNull();
    expect(lastFourOf(null)).toBeNull();
  });

  const candidates: LinkCandidate[] = [
    {
      id: "a",
      kind: "CREDIT_CARD",
      name: "Mastercard",
      institution: "Banco Aurora",
      lastFours: ["0001"],
      linked: false,
    },
    {
      id: "b",
      kind: "CREDIT_CARD",
      name: "Visa Casa",
      institution: "Banco Exemplo",
      lastFours: ["0002"],
      linked: false,
    },
    {
      id: "c",
      kind: "CHECKING",
      name: "Conta corrente Aurora",
      institution: "Banco Aurora",
      lastFours: [],
      linked: false,
    },
    {
      id: "d",
      kind: "CHECKING",
      name: "Conta antiga",
      institution: null,
      lastFours: [],
      linked: true,
    },
  ];

  it("cartão pelo final; conta pelo nome; ligada ou empatada não é sugerida", () => {
    expect(
      suggestAccountLink(
        { kind: "CREDIT_CARD", name: "MASTERCARD GOLD", number: "****0001" },
        candidates,
      ),
    ).toEqual({
      accountId: "a",
      reason: "LAST_FOUR",
    });
    expect(
      suggestAccountLink(
        { kind: "CHECKING", name: "Conta Corrente", number: "12345-6" },
        candidates,
      ),
    ).toEqual({
      accountId: "c",
      reason: "NAME",
    });
    expect(
      suggestAccountLink({ kind: "CHECKING", name: "Conta antiga", number: null }, candidates),
    ).toBeNull();
    expect(
      suggestAccountLink({ kind: "SAVINGS", name: "Poupança", number: "0003" }, candidates),
    ).toBeNull();
  });
});

describe("importChanges", () => {
  const base: ImportedFields = {
    occurredOn: "2026-10-09",
    description: "MERCADO BOM PRECO",
    amount: -31248n,
    statementExternalId: null,
    cardLastFour: "0001",
    installment: null,
    original: null,
    providerCategory: "Supermercados",
  };

  it("mesmo lançamento: nada a gravar (buscar duas vezes não muda nada)", () => {
    expect(importChanges(base, { ...base })).toEqual([]);
  });

  it("aponta só o que o banco corrigiu", () => {
    expect(
      importChanges(base, { ...base, statementExternalId: "bill-1", amount: -31250n }),
    ).toEqual(["amount", "statementExternalId"]);
    expect(importChanges(base, { ...base, installment: { number: 3, count: 6 } })).toEqual([
      "installment",
    ]);
  });
});

describe("importedDescription", () => {
  it("espaços simples, nunca vazia e no máximo 200 caracteres", () => {
    expect(importedDescription("  POSTO   ESTRELA ")).toBe("POSTO ESTRELA");
    expect(importedDescription("   ")).toBe("Lançamento do banco");
    expect(importedDescription("x".repeat(250))).toHaveLength(200);
  });
});

describe("importWalletFor", () => {
  const account = { walletId: "w-lia", holderId: "lia" };
  const personalWallets = new Map([
    ["lia", "w-lia"],
    ["caio", "w-caio"],
  ]);

  it("adicional do cônjuge: a compra entra no ambiente pessoal de quem usou o cartão", () => {
    expect(
      importWalletFor({
        account,
        card: { holderId: "caio", importWalletId: null },
        personalWallets,
      }),
    ).toEqual({ walletId: "w-caio", viewerId: "caio" });
  });

  it("o ambiente escolhido para o cartão vence a regra padrão", () => {
    expect(
      importWalletFor({
        account,
        card: { holderId: "caio", importWalletId: "w-casa" },
        personalWallets,
      }),
    ).toEqual({ walletId: "w-casa", viewerId: null });
  });

  it("cartão do titular, cartão sem portador ou sem cartão: o ambiente da conta", () => {
    for (const card of [
      { holderId: "lia", importWalletId: null },
      { holderId: null, importWalletId: null },
      null,
    ]) {
      expect(importWalletFor({ account, card, personalWallets }).walletId).toBe("w-lia");
    }
  });
});
