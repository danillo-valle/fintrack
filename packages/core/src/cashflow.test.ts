import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  cashBucketOf,
  cashDateFor,
  cashFlow,
  isAfter,
  pendingOccurrences,
  type CashMovement,
} from "./cashflow";
import { decimalToCents } from "./money";

const brl = decimalToCents;
const card = { kind: "CREDIT_CARD", cycle: { closingDay: 3, dueDay: 10 } };
const checking = { kind: "CHECKING", cycle: null };

describe("cashDateFor: quando o dinheiro sai", () => {
  it("compra no cartão sai no vencimento da fatura", () => {
    expect(cashDateFor("2026-10-09", card)).toBe("2026-11-10"); // depois do fechamento (3)
    expect(cashDateFor("2026-10-02", card)).toBe("2026-10-10"); // antes do fechamento
  });

  it("a fatura gravada manda (parcela já com a fatura certa)", () => {
    expect(cashDateFor("2026-10-09", card, "2026-12-10")).toBe("2026-12-10");
  });

  it("Pix, débito e dinheiro saem no dia; cartão sem ciclo também", () => {
    expect(cashDateFor("2026-10-09", checking)).toBe("2026-10-09");
    expect(cashDateFor("2026-10-09", { kind: "CREDIT_CARD", cycle: null })).toBe("2026-10-09");
  });
});

describe("cashBucketOf", () => {
  it("entrada, fixa (recorrência) ou outra saída", () => {
    expect(cashBucketOf(brl("8450"), true)).toBe("income");
    expect(cashBucketOf(brl("-2200"), true)).toBe("fixed");
    expect(cashBucketOf(brl("-42.35"), false)).toBe("other");
  });
});

describe("cashFlow: o resultado do mês, acumulado a partir de zero", () => {
  const months = ["2026-10", "2026-11", "2026-12"];
  const mv = (date: string, value: string, bucket: CashMovement["bucket"]): CashMovement => ({
    date,
    amount: brl(value),
    bucket,
  });

  it("o exemplo do canvas: outubro e novembro", () => {
    const rows = cashFlow(
      [
        mv("2026-10-07", "8450", "income"),
        mv("2026-10-10", "-2869.60", "fixed"),
        mv("2026-10-10", "-3120.45", "other"),
        mv("2026-10-15", "-1922.25", "other"),
        mv("2026-11-07", "8450", "income"),
        mv("2026-11-10", "-2869.60", "fixed"),
        mv("2026-11-10", "-2300.75", "other"),
        mv("2027-01-10", "-999", "other"), // fora do horizonte: ignorado
      ],
      months,
    );
    expect(rows[0]).toEqual({
      month: "2026-10",
      income: brl("8450"),
      fixed: brl("2869.60"),
      other: brl("5042.70"),
      net: brl("537.70"),
      cumulative: brl("537.70"),
    });
    expect(rows[1]).toMatchObject({ net: brl("3279.65"), cumulative: brl("3817.35") });
    expect(rows[2]).toMatchObject({ net: 0n, cumulative: brl("3817.35") });
  });

  it("propriedade: o acumulado do último mês é a soma de todos os movimentos do horizonte", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            day: fc.integer({ min: 1, max: 28 }),
            m: fc.integer({ min: 0, max: 2 }),
            cents: fc.bigInt(-(10n ** 8n), 10n ** 8n).filter((c) => c !== 0n),
          }),
        ),
        (items) => {
          const movements = items.map((i) => ({
            date: `${months[i.m]}-${String(i.day).padStart(2, "0")}`,
            amount: i.cents,
            bucket: cashBucketOf(i.cents, i.m === 1),
          }));
          const rows = cashFlow(movements, months);
          const total = movements.reduce((s, x) => s + x.amount, 0n);
          return rows.at(-1)?.cumulative === total;
        },
      ),
    );
  });
});

describe("pendingOccurrences: recorrência que ainda não virou lançamento", () => {
  const aluguel = {
    id: "r1",
    dayOfMonth: 10,
    startsOn: "2026-01-10",
    endsOn: null,
    amount: brl("-2200"),
    materialized: new Set(["2026-10"]),
  };

  it("pula o mês já lançado e o mês fechado; entra o futuro", () => {
    expect(
      pendingOccurrences(aluguel, ["2026-09", "2026-10", "2026-11", "2026-12"], "2026-10-09"),
    ).toEqual([
      { month: "2026-11", date: "2026-11-10" },
      { month: "2026-12", date: "2026-12-10" },
    ]);
  });

  it("o mês de hoje ainda não lançado conta, mesmo com o dia já passado", () => {
    const luz = { ...aluguel, dayOfMonth: 5, materialized: new Set<string>() };
    expect(pendingOccurrences(luz, ["2026-10"], "2026-10-09")).toEqual([
      { month: "2026-10", date: "2026-10-05" },
    ]);
  });

  it("respeita início e fim", () => {
    const curta = {
      ...aluguel,
      startsOn: "2026-11-10",
      endsOn: "2026-11-30",
      materialized: new Set<string>(),
    };
    expect(pendingOccurrences(curta, ["2026-10", "2026-11", "2026-12"], "2026-10-09")).toEqual([
      { month: "2026-11", date: "2026-11-10" },
    ]);
  });

  it("isAfter", () => {
    expect(isAfter("2026-10-10", "2026-10-09")).toBe(true);
    expect(isAfter("2026-10-09", "2026-10-09")).toBe(false);
  });
});
