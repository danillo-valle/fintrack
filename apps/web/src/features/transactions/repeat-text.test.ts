import { describe, expect, it } from "vitest";
import { dayText, endsText, whenText } from "./repeat-text";

describe("repeat-text", () => {
  it("o dia do mês e o dia útil", () => {
    expect(dayText("DAY", 1)).toBe("todo dia 01");
    expect(dayText("BUSINESS_DAY", 5)).toBe("5º dia útil");
    expect(whenText("DAY", 28)).toBe("por volta do dia 28");
    expect(whenText("BUSINESS_DAY", 5)).toBe("no 5º dia útil");
  });
  it("o fim", () => {
    expect(endsText(null)).toBe("sem fim");
    expect(endsText("2026-12-31")).toBe("até dez/2026");
  });
});
