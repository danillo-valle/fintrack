import { describe, expect, it } from "vitest";
import { decimalToCents } from "./money";
import {
  expectedAmount,
  forecastLines,
  forecastState,
  projectedInstallments,
  recurrenceSettingsValid,
  seriesKey,
  upcomingItems,
  upcomingMonths,
  type ForecastInstallment,
  type ForecastRecurrence,
  type RecurrenceSettings,
} from "./recurring";
import { occurrenceIn } from "./transactions";

const brl = decimalToCents;

describe("o que se repete (ADR-027)", () => {
  it("a chave do comerciante: o mesmo texto com números diferentes é a mesma cobrança", () => {
    expect(seriesKey("SPOTIFY *1234567")).toBe(seriesKey("Spotify 9876543"));
    expect(seriesKey("NETFLIX.COM")).toBe("netflix");
    expect(seriesKey("123456").length).toBeGreaterThan(0);
  });

  it("o valor previsto: o último, a média de 3 meses ou o gravado", () => {
    const arrivals = [
      { occurredOn: "2026-09-01", amount: brl("10120.00") },
      { occurredOn: "2026-10-01", amount: brl("9850.00") },
      { occurredOn: "2026-11-01", amount: brl("9850.00") },
      { occurredOn: "2026-08-01", amount: brl("1.00") },
    ];
    expect(expectedAmount("LAST", brl("1"), arrivals)).toBe(brl("9850.00"));
    expect(expectedAmount("AVERAGE_3", brl("1"), arrivals)).toBe(brl("9940.00"));
    expect(expectedAmount("FIXED", brl("9000"), arrivals)).toBe(brl("9000"));
    // o previsto de novembro é o que se sabia antes de novembro
    expect(expectedAmount("LAST", brl("1"), arrivals, "2026-11")).toBe(brl("9850.00"));
    expect(expectedAmount("AVERAGE_3", brl("1"), arrivals, "2026-11")).toBe(
      brl("6657.00"), // (9850 + 10120 + 1) / 3
    );
    // sem nada que chegou: o gravado
    expect(expectedAmount("LAST", brl("21.90"), [])).toBe(brl("21.90"));
  });

  it("duas cobranças no mesmo mês somam no mês", () => {
    const arrivals = [
      { occurredOn: "2026-10-02", amount: brl("-21.90") },
      { occurredOn: "2026-10-20", amount: brl("-21.90") },
    ];
    expect(expectedAmount("LAST", 0n, arrivals)).toBe(brl("-43.80"));
  });

  it("as parcelas que faltam, uma por fatura seguinte, no dia do vencimento", () => {
    const parcels = [
      { key: "nb", number: 1, count: 5, amount: brl("-640"), dueDate: "2026-10-09" },
      { key: "nb", number: 2, count: 5, amount: brl("-640"), dueDate: "2026-11-09" },
      { key: "fim", number: 3, count: 3, amount: brl("-97.64"), dueDate: "2026-11-09" },
    ];
    expect(
      projectedInstallments(parcels).map((p) => [p.key, p.number, p.month, p.dueDate]),
    ).toEqual([
      ["nb", 3, "2026-12", "2026-12-09"],
      ["nb", 4, "2027-01", "2027-01-09"],
      ["nb", 5, "2027-02", "2027-02-09"],
    ]);
  });

  it("o 5º dia útil numa recorrência, e a prevista que passou do dia", () => {
    const salary = {
      id: "s",
      dayOfMonth: 5,
      dayRule: "BUSINESS_DAY" as const,
      startsOn: "2026-01-01",
      endsOn: null,
    };
    expect(occurrenceIn(salary, "2026-11")).toBe("2026-11-09");
    expect(forecastState("2026-11-02", "2026-11-05")).toBe("late");
    expect(forecastState("2026-11-09", "2026-11-05")).toBe("expected");
  });

  it("os próximos meses: o que entra, as fixas da conta, a fatura e a sobra", () => {
    const rows = upcomingMonths(
      ["2026-12", "2027-01"],
      [
        { month: "2026-12", part: "income", amount: brl("9940") },
        { month: "2026-12", part: "account", amount: brl("4362.48") },
        { month: "2026-12", part: "card", amount: brl("1076.40") },
        { month: "2027-01", part: "income", amount: brl("9940") },
        { month: "2027-03", part: "card", amount: brl("1") },
      ],
    );
    expect(rows).toEqual([
      {
        month: "2026-12",
        income: brl("9940"),
        account: brl("4362.48"),
        card: brl("1076.40"),
        left: brl("4501.12"),
      },
      { month: "2027-01", income: brl("9940"), account: 0n, card: 0n, left: brl("9940") },
    ]);
  });
});

describe("recurrenceSettingsValid", () => {
  const base: RecurrenceSettings = {
    amountRule: "LAST",
    fixed: null,
    dayRule: "DAY",
    day: 10,
    endsOn: null,
  };
  it("aceita a do banco com o último ou a média, e o valor fixo maior que zero", () => {
    expect(recurrenceSettingsValid("BANK", "2026-11-01", base)).toBe(true);
    expect(
      recurrenceSettingsValid("BANK", "2026-11-01", { ...base, amountRule: "AVERAGE_3" }),
    ).toBe(true);
    expect(
      recurrenceSettingsValid("BANK", "2026-11-01", { ...base, amountRule: "FIXED", fixed: 100n }),
    ).toBe(true);
  });
  it("recusa a do app sem valor fixo e o valor fixo zero ou ausente", () => {
    expect(recurrenceSettingsValid("APP", "2026-11-01", base)).toBe(false);
    expect(
      recurrenceSettingsValid("BANK", "2026-11-01", { ...base, amountRule: "FIXED", fixed: 0n }),
    ).toBe(false);
    expect(
      recurrenceSettingsValid("BANK", "2026-11-01", { ...base, amountRule: "FIXED", fixed: null }),
    ).toBe(false);
    expect(recurrenceSettingsValid("BANK", "2026-11-01", { ...base, fixed: 100n })).toBe(false);
  });
  it("o dia útil vai até o 23º e o dia do mês até 31", () => {
    expect(
      recurrenceSettingsValid("BANK", "2026-11-01", { ...base, dayRule: "BUSINESS_DAY", day: 5 }),
    ).toBe(true);
    expect(
      recurrenceSettingsValid("BANK", "2026-11-01", { ...base, dayRule: "BUSINESS_DAY", day: 24 }),
    ).toBe(false);
    expect(recurrenceSettingsValid("BANK", "2026-11-01", { ...base, day: 31 })).toBe(true);
    expect(recurrenceSettingsValid("BANK", "2026-11-01", { ...base, day: 0 })).toBe(false);
  });
  it("o fim não vem antes do início", () => {
    expect(recurrenceSettingsValid("BANK", "2026-11-01", { ...base, endsOn: "2026-12-31" })).toBe(
      true,
    );
    expect(recurrenceSettingsValid("BANK", "2026-11-01", { ...base, endsOn: "2026-10-31" })).toBe(
      false,
    );
  });
});

describe("forecastLines", () => {
  const owner = { walletId: "w", categoryId: null, payer: null };
  const salary: ForecastRecurrence & { id: string } = {
    ...owner,
    id: "sal",
    accountId: "conta",
    amount: 985000n,
    dayOfMonth: 5,
    dayRule: "BUSINESS_DAY",
    startsOn: "2026-10-01",
    endsOn: null,
    materialized: new Set(["2026-11"]),
    account: { kind: "CHECKING", cycle: null },
  };
  const spotify: ForecastRecurrence & { id: string } = {
    ...owner,
    id: "spo",
    accountId: "cartao",
    amount: -2190n,
    dayOfMonth: 2,
    startsOn: "2026-10-01",
    endsOn: null,
    materialized: new Set(),
    account: { kind: "CREDIT_CARD", cycle: { closingDay: 3, dueDay: 9 } },
  };
  const parcel: ForecastInstallment = {
    ...owner,
    accountId: "cartao",
    accountKind: "CREDIT_CARD",
    key: "note",
    number: 3,
    count: 5,
    amount: -64000n,
    dueDate: "2026-12-09",
    month: "2026-12",
  };

  it("a recorrência que ainda não chegou e a parcela que falta, pelo dia de caixa", () => {
    const lines = forecastLines([salary, spotify], [parcel], ["2026-12"], "2026-11-03");
    expect(lines.map((l) => [l.source, l.sourceId, l.date, l.cashDate, l.month])).toEqual([
      ["recurrence", "sal", "2026-12-07", "2026-12-07", "2026-12"],
      // a assinatura do dia 02/11 fecha em 03/11 e vence em 09/11; a de 02/12, em 09/12
      ["installment", "note", "2026-12-09", "2026-12-09", "2026-12"],
      ["recurrence", "spo", "2026-12-02", "2026-12-09", "2026-12"],
    ]);
    expect(lines[1]?.installment).toEqual({ number: 3, count: 5 });
  });

  it("o mês já realizado não se repete, e o que passou do dia é 'não chegou'", () => {
    const lines = forecastLines([salary, spotify], [], ["2026-11"], "2026-11-05");
    expect(lines.map((l) => [l.sourceId, l.state])).toEqual([["spo", "late"]]);
  });

  it("as partes do Próximos meses: entra, fixa da conta e a fatura com o que já chegou", () => {
    const lines = forecastLines([salary, spotify], [parcel], ["2026-12"], "2026-11-03");
    const items = upcomingItems(lines, [{ month: "2026-12", amount: 10000n }]);
    expect(upcomingMonths(["2026-12"], items)).toEqual([
      {
        month: "2026-12",
        income: 985000n,
        account: 0n,
        card: 10000n + 64000n + 2190n,
        left: 985000n - 10000n - 64000n - 2190n,
      },
    ]);
  });
});
