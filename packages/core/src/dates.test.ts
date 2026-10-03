import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  addDays,
  addMonths,
  addMonthsToKey,
  civilDate,
  civilFromDbDate,
  compareCivil,
  dayOfMonth,
  daysBetween,
  daysInMonth,
  dbDateFromCivil,
  firstDayOf,
  isCivilDate,
  monthOf,
  parseCivilDate,
  todayCivil,
} from "./dates";

/** Qualquer data entre 2000 e 2099, gerada como data civil válida. */
const anyDate = fc
  .date({
    min: new Date(Date.UTC(2000, 0, 1)),
    max: new Date(Date.UTC(2099, 11, 31)),
    noInvalidDate: true,
  })
  .map((d) => civilDate(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()));

describe("datas civis: exemplos", () => {
  it("dias de cada mês, com ano bissexto", () => {
    expect(daysInMonth(2026, 2)).toBe(28);
    expect(daysInMonth(2028, 2)).toBe(29);
    expect(daysInMonth(2026, 4)).toBe(30);
    expect(daysInMonth(2026, 12)).toBe(31);
  });

  it("recusa datas que não existem", () => {
    expect(isCivilDate("2026-02-29")).toBe(false);
    expect(isCivilDate("2026-04-31")).toBe(false);
    expect(isCivilDate("2026-13-01")).toBe(false);
    expect(isCivilDate("02/10/2026")).toBe(false);
    expect(isCivilDate("2028-02-29")).toBe(true);
    expect(() => civilDate(2026, 2, 30)).toThrow(/Dia inválido/);
  });

  it("meses e dias atravessam o ano", () => {
    expect(addMonthsToKey("2026-11", 3)).toBe("2027-02");
    expect(addMonthsToKey("2026-01", -1)).toBe("2025-12");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("dia 31 encosta no fim dos meses curtos", () => {
    expect(dayOfMonth("2026-02", 31)).toBe("2026-02-28");
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2026-01-31", 2)).toBe("2026-03-31");
    expect(firstDayOf("2026-10")).toBe("2026-10-01");
  });

  it("dias entre datas e comparação", () => {
    expect(daysBetween("2026-10-01", "2026-10-31")).toBe(30);
    expect(daysBetween("2026-12-25", "2027-01-05")).toBe(11);
    expect(compareCivil("2026-09-30", "2026-10-01")).toBeLessThan(0);
  });

  it("hoje em São Paulo, não em UTC", () => {
    // 01:30 de 1º de outubro em UTC ainda é 22:30 de 30 de setembro em São Paulo
    expect(todayCivil(new Date("2026-10-01T01:30:00Z"))).toBe("2026-09-30");
    expect(todayCivil(new Date("2026-10-01T15:00:00Z"))).toBe("2026-10-01");
  });

  it("ponte com a coluna DATE do Prisma (meia-noite UTC)", () => {
    expect(dbDateFromCivil("2026-10-02").toISOString()).toBe("2026-10-02T00:00:00.000Z");
    expect(civilFromDbDate(new Date("2026-10-02T00:00:00.000Z"))).toBe("2026-10-02");
  });
});

describe("datas civis: propriedades", () => {
  it("toda data gerada volta igual depois de separada e remontada", () => {
    fc.assert(
      fc.property(anyDate, (date) => {
        const { year, month, day } = parseCivilDate(date);
        expect(civilDate(year, month, day)).toBe(date);
      }),
    );
  });

  it("ida e volta pela coluna DATE não muda o dia", () => {
    fc.assert(
      fc.property(anyDate, (date) => {
        expect(civilFromDbDate(dbDateFromCivil(date))).toBe(date);
      }),
    );
  });

  it("somar n dias e depois subtrair n dias volta ao mesmo dia", () => {
    fc.assert(
      fc.property(anyDate, fc.integer({ min: -800, max: 800 }), (date, n) => {
        expect(addDays(addDays(date, n), -n)).toBe(date);
        expect(daysBetween(date, addDays(date, n))).toBe(n);
      }),
    );
  });

  it("somar meses sempre cai no mês certo e nunca passa do fim dele", () => {
    fc.assert(
      fc.property(anyDate, fc.integer({ min: -36, max: 36 }), (date, n) => {
        const moved = addMonths(date, n);
        expect(monthOf(moved)).toBe(addMonthsToKey(monthOf(date), n));
        expect(parseCivilDate(moved).day).toBeLessThanOrEqual(parseCivilDate(date).day);
      }),
    );
  });
});
