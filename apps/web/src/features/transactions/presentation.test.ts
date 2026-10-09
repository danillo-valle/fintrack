import { describe, expect, it } from "vitest";
import { dayLabel, periodPresets } from "./presentation";

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

describe("periodPresets", () => {
  it("este mês, mês passado e os últimos 3 meses, com o último dia certo", () => {
    expect(periodPresets("2026-03-15")).toEqual([
      { label: "Este mês", from: "2026-03-01", to: "2026-03-31" },
      { label: "Mês passado", from: "2026-02-01", to: "2026-02-28" },
      { label: "Últimos 3 meses", from: "2026-01-01", to: "2026-03-31" },
    ]);
  });

  it("janeiro: o mês passado é dezembro do ano anterior", () => {
    expect(periodPresets("2026-01-10")[1]).toEqual({
      label: "Mês passado",
      from: "2025-12-01",
      to: "2025-12-31",
    });
  });
});
