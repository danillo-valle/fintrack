import { describe, expect, it } from "vitest";
import {
  dayInWords,
  dayLabel,
  periodChoices,
  periodPresets,
  periodShort,
  periodTitle,
  sliceTitle,
} from "./presentation";

describe("dayLabel", () => {
  const today = "2026-10-08"; // uma quinta-feira

  it("hoje e ontem ganham o nome do dia antes", () => {
    expect(dayLabel("2026-10-08", today)).toBe("Hoje, quinta-feira, 8 de outubro");
    expect(dayLabel("2026-10-07", today)).toBe("Ontem, quarta-feira, 7 de outubro");
  });

  it("os outros dias começam com maiúscula", () => {
    expect(dayLabel("2026-10-06", today)).toBe("Terça-feira, 6 de outubro");
  });

  it("ontem atravessa a virada do mês e do ano", () => {
    expect(dayLabel("2025-12-31", "2026-01-01")).toBe(
      "Ontem, quarta-feira, 31 de dezembro de 2025",
    );
  });

  it("de outro ano mostra o ano", () => {
    expect(dayLabel("2025-10-08", today)).toBe("Quarta-feira, 8 de outubro de 2025");
  });
});

describe("periodPresets e o título do período (M13.3a)", () => {
  it("este mês, mês passado e os últimos 3 meses, em meses", () => {
    expect(periodPresets("2026-03-15")).toEqual([
      { label: "Este mês", months: ["2026-03"] },
      { label: "Mês passado", months: ["2026-02"] },
      { label: "Últimos 3 meses", months: ["2026-01", "2026-02", "2026-03"] },
    ]);
    expect(periodPresets("2026-01-10")[1]).toEqual({ label: "Mês passado", months: ["2025-12"] });
  });

  it("os 12 meses do combo, do mais recente para o mais antigo", () => {
    const months = periodChoices("2026-11-03");
    expect(months).toHaveLength(12);
    expect([months[0], months.at(-1)]).toEqual(["2026-11", "2025-12"]);
  });

  it("um mês, meses seguidos, meses soltos e dias", () => {
    const today = "2026-11-03";
    const m = (...months: string[]) => ({ kind: "months" as const, months });
    expect(periodTitle(m("2026-11"), today)).toBe("Novembro");
    expect(periodTitle(m("2025-12"), today)).toBe("Dezembro de 2025");
    expect(periodTitle(m("2026-09", "2026-10", "2026-11"), today)).toBe("Setembro a novembro");
    expect(periodTitle(m("2026-08", "2026-10"), today)).toBe("Agosto e outubro");
    expect(periodShort(m("2026-09", "2026-10", "2026-11"), today)).toBe("3 meses");
    expect(periodTitle({ kind: "range", from: "2026-11-01", to: "2026-11-03" }, today)).toBe(
      "01/11 a 03/11",
    );
    expect(periodTitle({ kind: "range", from: "2026-11-01", to: "2026-11-30" }, today)).toBe(
      "Novembro",
    );
    expect(
      sliceTitle({
        category: null,
        type: "expense",
        period: { kind: "range", from: "2026-11-01", to: "2026-11-30" },
        upTo: "2026-11-03",
        today,
      }),
    ).toBe("Saídas · novembro até 03/11");
    expect(dayInWords("2026-11-01")).toBe("1º de novembro");
    expect(dayInWords("2026-09-15")).toBe("15 de setembro");
  });
});
