// Lançamentos (M07): sinal do valor, forma de pagamento, transferência, totais, cursor e
// recorrências. Exemplos escolhidos à mão + propriedades (fast-check).
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { sumCents } from "./money";
import {
  ACCOUNT_KINDS,
  allowedMethods,
  compareListOrder,
  decodeCursor,
  defaultMethod,
  encodeCursor,
  kindAndAbs,
  methodAllowsCard,
  monthRange,
  monthsBetween,
  occurrenceIn,
  recurrenceExternalId,
  signedAmount,
  totalsOf,
  transferLegs,
} from "./transactions";

describe("signedAmount: a pessoa digita positivo, o tipo decide o sinal", () => {
  it("despesa vira negativo, receita fica positivo", () => {
    expect(signedAmount("expense", 4235n)).toBe(-4235n);
    expect(signedAmount("income", 850000n)).toBe(850000n);
  });

  it("recusa zero, negativo e o que não cabe na coluna", () => {
    expect(() => signedAmount("expense", 0n)).toThrow();
    expect(() => signedAmount("expense", -1n)).toThrow();
    expect(() => signedAmount("income", 100_000_000_000_000n)).toThrow();
  });

  it("propriedade: kindAndAbs desfaz signedAmount", () => {
    fc.assert(
      fc.property(
        fc.constantFrom("expense" as const, "income" as const),
        fc.bigInt({ min: 1n, max: 99_999_999_999_999n }),
        (kind, cents) => {
          expect(kindAndAbs(signedAmount(kind, cents))).toEqual({ kind, cents });
        },
      ),
    );
  });
});

describe("forma de pagamento × tipo de conta (a mesma regra do gatilho do banco)", () => {
  it("cartão de crédito: só CREDIT", () => {
    expect(allowedMethods("CREDIT_CARD")).toEqual(["CREDIT"]);
  });

  it("vale-refeição: vale ou depósito (a recarga)", () => {
    expect(allowedMethods("MEAL_VOUCHER")).toEqual(["VOUCHER", "DEPOSIT"]);
  });

  it("corrente, poupança e dinheiro: tudo menos crédito e vale", () => {
    for (const kind of ["CHECKING", "SAVINGS", "CASH"] as const) {
      expect(allowedMethods(kind)).not.toContain("CREDIT");
      expect(allowedMethods(kind)).not.toContain("VOUCHER");
      expect(allowedMethods(kind)).toContain("PIX");
    }
  });

  it("a forma padrão é sempre uma das aceitas pela conta", () => {
    for (const account of ACCOUNT_KINDS) {
      for (const kind of ["expense", "income"] as const) {
        expect(allowedMethods(account)).toContain(defaultMethod(account, kind));
      }
    }
  });

  it("cartão só com crédito, débito ou vale", () => {
    expect(methodAllowsCard("CREDIT")).toBe(true);
    expect(methodAllowsCard("PIX")).toBe(false);
  });
});

describe("transferência", () => {
  it("sai de uma, entra na outra, mesmo valor", () => {
    expect(transferLegs({ fromAccountId: "a", toAccountId: "b", cents: 1500n })).toEqual([
      { accountId: "a", amount: -1500n },
      { accountId: "b", amount: 1500n },
    ]);
  });

  it("recusa a mesma conta nos dois lados", () => {
    expect(() => transferLegs({ fromAccountId: "a", toAccountId: "a", cents: 1n })).toThrow();
  });

  it("propriedade: os dois lados somam zero", () => {
    fc.assert(
      fc.property(fc.bigInt({ min: 1n, max: 99_999_999_999_999n }), (cents) => {
        const legs = transferLegs({ fromAccountId: "a", toAccountId: "b", cents });
        expect(sumCents(legs.map((l) => l.amount))).toBe(0n);
      }),
    );
  });
});

describe("totais da lista", () => {
  it("entradas e saídas ignoram transferências; o total de linhas conta todas", () => {
    const totals = totalsOf([
      { amount: -4235n, transferId: null },
      { amount: 850000n, transferId: null },
      { amount: -150000n, transferId: "t1" },
      { amount: 150000n, transferId: "t1" },
    ]);
    expect(totals).toEqual({ income: 850000n, expense: -4235n, net: 845765n, count: 4 });
  });

  it("propriedade: entradas + saídas = saldo, e saldo = soma de quem não é transferência", () => {
    const row = fc.record({
      amount: fc.bigInt({ min: -9_999_999n, max: 9_999_999n }).filter((v) => v !== 0n),
      transferId: fc.option(fc.constant("t"), { nil: null }),
    });
    fc.assert(
      fc.property(fc.array(row, { maxLength: 50 }), (rows) => {
        const t = totalsOf(rows);
        expect(t.income + t.expense).toBe(t.net);
        expect(t.net).toBe(sumCents(rows.filter((r) => !r.transferId).map((r) => r.amount)));
        expect(t.count).toBe(rows.length);
      }),
    );
  });
});

describe("cursor da paginação", () => {
  const id = "0199b5c2-7d0e-7a3b-8c1d-2e3f4a5b6c7d";

  it("ida e volta", () => {
    expect(decodeCursor(encodeCursor({ occurredOn: "2026-10-07", id }))).toEqual({
      occurredOn: "2026-10-07",
      id,
    });
  });

  it.each([null, "", "lixo", "2026-13-01_" + id, "2026-10-07_nao-uuid", `2026-10-07_${id}_x`])(
    "cursor inválido (%j) recomeça do topo",
    (value) => {
      expect(decodeCursor(value)).toBeNull();
    },
  );

  it("ordem: data mais nova primeiro; mesma data, id maior primeiro", () => {
    const a = { occurredOn: "2026-10-07", id: "0199b5c2-0000-7000-8000-000000000002" };
    const b = { occurredOn: "2026-10-07", id: "0199b5c2-0000-7000-8000-000000000001" };
    const c = { occurredOn: "2026-10-06", id: "0199b5c2-0000-7000-8000-000000000009" };
    expect([c, b, a].sort(compareListOrder)).toEqual([a, b, c]);
  });
});

describe("recorrências", () => {
  const rent = { id: "r", dayOfMonth: 31, startsOn: "2026-01-15", endsOn: "2026-06-30" };

  it("dia 31 cai no último dia dos meses curtos", () => {
    expect(occurrenceIn(rent, "2026-02")).toBe("2026-02-28");
    expect(occurrenceIn(rent, "2026-04")).toBe("2026-04-30");
    expect(occurrenceIn(rent, "2026-03")).toBe("2026-03-31");
  });

  it("fora do período: nada", () => {
    expect(occurrenceIn({ ...rent, dayOfMonth: 10 }, "2026-01")).toBeNull(); // antes do início
    expect(occurrenceIn(rent, "2026-07")).toBeNull(); // depois do fim
    expect(occurrenceIn({ ...rent, endsOn: null }, "2030-07")).toBe("2030-07-31");
  });

  it("externalId estável por recorrência e mês (gerar duas vezes não duplica)", () => {
    expect(recurrenceExternalId("abc", "2026-10")).toBe("abc:2026-10");
    expect(() => recurrenceExternalId("abc", "2026-13")).toThrow();
  });

  it("meses de um intervalo e o período padrão da lista", () => {
    expect(monthsBetween("2026-11", "2027-02")).toEqual([
      "2026-11",
      "2026-12",
      "2027-01",
      "2027-02",
    ]);
    expect(monthRange("2026-02-10")).toEqual({ from: "2026-02-01", to: "2026-02-28" });
  });
});
