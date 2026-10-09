import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  installmentEntries,
  installmentPlan,
  statementFor,
  statementOfMonth,
  type CardCycle,
} from "./card";
import { addDays, addMonthsToKey, civilDate, compareCivil, daysBetween, monthOf } from "./dates";
import { sumCents } from "./money";

/** Cartão que fecha dia 25 e vence dia 5 do mês seguinte. */
const NEXT_MONTH: CardCycle = { closingDay: 25, dueDay: 5 };
/** Cartão que fecha dia 3 e vence dia 10 do mesmo mês. */
const SAME_MONTH: CardCycle = { closingDay: 3, dueDay: 10 };

describe("fatura do cartão: exemplos", () => {
  it("compra antes do fechamento entra na fatura do mês", () => {
    expect(statementFor("2026-10-24", NEXT_MONTH)).toEqual({
      referenceMonth: "2026-10",
      closingDate: "2026-10-25",
      dueDate: "2026-11-05",
    });
  });

  it("compra no dia do fechamento já vai para a próxima (o 'melhor dia de compra')", () => {
    expect(statementFor("2026-10-25", NEXT_MONTH).referenceMonth).toBe("2026-11");
  });

  it("compra de 28/09 num cartão que fecha 25: fatura de outubro, paga em 05/11", () => {
    const statement = statementFor("2026-09-28", NEXT_MONTH);
    expect(statement.referenceMonth).toBe("2026-10");
    expect(statement.dueDate).toBe("2026-11-05");
  });

  it("vencimento no mesmo mês quando o dia vem depois do fechamento", () => {
    expect(statementOfMonth("2026-10", SAME_MONTH)).toEqual({
      referenceMonth: "2026-10",
      closingDate: "2026-10-03",
      dueDate: "2026-10-10",
    });
  });

  it("fechamento no dia 31 encosta no fim de fevereiro", () => {
    const statement = statementOfMonth("2027-02", { closingDay: 31, dueDay: 8 });
    expect(statement.closingDate).toBe("2027-02-28");
    expect(statement.dueDate).toBe("2027-03-08");
  });

  it("dezembro com vencimento em janeiro atravessa o ano", () => {
    expect(statementFor("2026-12-30", NEXT_MONTH)).toEqual({
      referenceMonth: "2027-01",
      closingDate: "2027-01-25",
      dueDate: "2027-02-05",
    });
  });

  it("recusa ciclos inválidos", () => {
    expect(() => statementOfMonth("2026-10", { closingDay: 0, dueDay: 5 })).toThrow(/fechamento/);
    expect(() => statementOfMonth("2026-10", { closingDay: 10, dueDay: 32 })).toThrow(/vencimento/);
    expect(() => statementOfMonth("2026-10", { closingDay: 10, dueDay: 10 })).toThrow(/diferente/);
  });
});

describe("compra parcelada: exemplos", () => {
  it("R$ 1.200,00 em 3x: uma parcela por fatura, a partir da fatura da compra", () => {
    const plan = installmentPlan({
      total: -120000n,
      count: 3,
      purchasedOn: "2026-09-28",
      cycle: NEXT_MONTH,
    });
    expect(plan.map((p) => [p.number, p.amount, p.referenceMonth, p.dueDate])).toEqual([
      [1, -40000n, "2026-10", "2026-11-05"],
      [2, -40000n, "2026-11", "2026-12-05"],
      [3, -40000n, "2026-12", "2027-01-05"],
    ]);
  });
});

// ── Propriedades ──────────────────────────────────────────────────────────────

const anyCycle = fc
  .record({ closingDay: fc.integer({ min: 1, max: 31 }), dueDay: fc.integer({ min: 1, max: 31 }) })
  .filter((c) => c.closingDay !== c.dueDay);

const anyDate = fc
  .date({
    min: new Date(Date.UTC(2020, 0, 1)),
    max: new Date(Date.UTC(2035, 11, 31)),
    noInvalidDate: true,
  })
  .map((d) => civilDate(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()));

describe("fatura do cartão: propriedades", () => {
  it("a compra sempre acontece antes do fechamento da fatura em que entra", () => {
    fc.assert(
      fc.property(anyDate, anyCycle, (date, cycle) => {
        expect(compareCivil(date, statementFor(date, cycle).closingDate)).toBeLessThan(0);
      }),
    );
  });

  it("o fechamento nunca fica a mais de 31 dias da compra", () => {
    fc.assert(
      fc.property(anyDate, anyCycle, (date, cycle) => {
        expect(daysBetween(date, statementFor(date, cycle).closingDate)).toBeLessThanOrEqual(31);
      }),
    );
  });

  it("o vencimento vem depois do fechamento, e no máximo um mês depois", () => {
    fc.assert(
      fc.property(anyDate, anyCycle, (date, cycle) => {
        const { closingDate, dueDate } = statementFor(date, cycle);
        const gap = daysBetween(closingDate, dueDate);
        expect(gap > 0 && gap <= 31).toBe(true);
      }),
    );
  });

  it("o mês de referência é o mês do fechamento", () => {
    fc.assert(
      fc.property(anyDate, anyCycle, (date, cycle) => {
        const statement = statementFor(date, cycle);
        expect(monthOf(statement.closingDate)).toBe(statement.referenceMonth);
      }),
    );
  });

  it("comprar um dia depois nunca joga a compra para uma fatura anterior", () => {
    fc.assert(
      fc.property(anyDate, anyCycle, (date, cycle) => {
        const today = statementFor(date, cycle).referenceMonth;
        const tomorrow = statementFor(addDays(date, 1), cycle).referenceMonth;
        expect(tomorrow >= today).toBe(true);
      }),
    );
  });

  it("parcelas: somam o total e caem em faturas consecutivas", () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: -10_000_000n, max: -1n }),
        fc.integer({ min: 1, max: 24 }),
        anyDate,
        anyCycle,
        (total, count, purchasedOn, cycle) => {
          const plan = installmentPlan({ total, count, purchasedOn, cycle });
          expect(sumCents(plan.map((p) => p.amount))).toBe(total);
          plan.forEach((p, i) => {
            expect(p.referenceMonth).toBe(addMonthsToKey(plan[0]?.referenceMonth ?? "", i));
          });
        },
      ),
    );
  });
});

describe("installmentEntries", () => {
  const cycle = { closingDay: 25, dueDay: 5 };

  it("uma parcela por mês, no dia da compra; a sobra de centavos vai na 1ª", () => {
    const entries = installmentEntries({
      total: -4235n,
      count: 3,
      purchasedOn: "2026-10-08",
      cycle,
      today: "2026-10-08",
    });
    expect(entries.map((e) => [e.occurredOn, e.amount, e.referenceMonth, e.status])).toEqual([
      ["2026-10-08", -1413n, "2026-10", "CONFIRMED"],
      ["2026-11-08", -1411n, "2026-11", "SCHEDULED"],
      ["2026-12-08", -1411n, "2026-12", "SCHEDULED"],
    ]);
    expect(entries.reduce((sum, e) => sum + e.amount, 0n)).toBe(-4235n);
  });

  it("dia 31 vira o último dia dos meses curtos, e a virada do ano funciona", () => {
    const entries = installmentEntries({
      total: -30000n,
      count: 3,
      purchasedOn: "2026-12-31",
      cycle,
      today: "2026-12-31",
    });
    expect(entries.map((e) => e.occurredOn)).toEqual(["2026-12-31", "2027-01-31", "2027-02-28"]);
  });

  it("compra lançada depois: as parcelas que já passaram entram confirmadas", () => {
    const entries = installmentEntries({
      total: -90000n,
      count: 3,
      purchasedOn: "2026-08-10",
      cycle,
      today: "2026-10-09",
    });
    // 10/08 e 10/09 já passaram; 10/10 ainda não chegou (hoje é 09/10)
    expect(entries.map((e) => e.status)).toEqual(["CONFIRMED", "CONFIRMED", "SCHEDULED"]);
  });

  it("compra depois do fechamento: a 1ª parcela já cai na fatura seguinte", () => {
    const [first] = installmentEntries({
      total: -10000n,
      count: 2,
      purchasedOn: "2026-10-26",
      cycle,
      today: "2026-10-26",
    });
    expect(first!.referenceMonth).toBe("2026-11");
    expect(first!.occurredOn).toBe("2026-10-26");
  });
});
