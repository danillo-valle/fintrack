import { describe, expect, it } from "vitest";
import { bankHolidays, easterSunday, isBusinessDay, nthBusinessDay } from "./business-days";

describe("dias úteis dos bancos (ADR-027)", () => {
  it("a Páscoa e os feriados móveis", () => {
    expect(easterSunday(2026)).toBe("2026-04-05");
    expect(easterSunday(2027)).toBe("2027-03-28");
    const h = bankHolidays(2026);
    expect(
      [...h].filter((d) => ["2026-02-16", "2026-02-17", "2026-04-03", "2026-06-04"].includes(d)),
    ).toHaveLength(4);
    expect(h.has("2026-11-20")).toBe(true);
    expect(bankHolidays(2023).has("2023-11-20")).toBe(false);
  });

  it("fim de semana e feriado não são dia útil", () => {
    expect(isBusinessDay("2026-11-07")).toBe(false); // sábado
    expect(isBusinessDay("2026-11-02")).toBe(false); // Finados, segunda
    expect(isBusinessDay("2026-11-03")).toBe(true);
  });

  it("o 5º dia útil pula o fim de semana e os feriados", () => {
    // Novembro de 2026: 2 (Finados) fora; 3, 4, 5, 6, 9
    expect(nthBusinessDay("2026-11", 5)).toBe("2026-11-09");
    // Janeiro de 2027: 1º feriado (sexta); 4, 5, 6, 7, 8
    expect(nthBusinessDay("2027-01", 5)).toBe("2027-01-08");
    expect(nthBusinessDay("2026-12", 1)).toBe("2026-12-01");
  });

  it("mais dias úteis do que o mês tem: o último dia útil", () => {
    expect(nthBusinessDay("2026-11", 23)).toBe("2026-11-30");
  });
});
