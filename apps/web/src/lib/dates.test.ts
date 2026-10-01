import { describe, expect, it } from "vitest";
import { formatDate, formatDateLong, formatMonth, todayISO } from "./dates";

// 01h UTC do dia 1º de outubro = 22h do dia 30 de setembro em São Paulo (UTC-3)
const lateNightSP = new Date("2026-10-01T01:00:00Z");

describe("datas no fuso de São Paulo", () => {
  it("mostra o dia de São Paulo, não o de UTC", () => {
    expect(formatDate(lateNightSP)).toBe("30/09/2026");
    expect(todayISO(lateNightSP)).toBe("2026-09-30");
  });

  it("escreve mês por extenso em português", () => {
    expect(formatDateLong(new Date("2026-10-15T15:00:00Z"))).toBe("15 de outubro de 2026");
    expect(formatMonth(lateNightSP)).toBe("setembro de 2026");
  });
});
