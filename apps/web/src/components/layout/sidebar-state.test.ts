import { describe, expect, it } from "vitest";
import { parseSidebarState } from "./sidebar-state";

describe("parseSidebarState", () => {
  it("só recolhe com o valor exato", () => {
    expect(parseSidebarState("collapsed")).toBe("collapsed");
  });

  it("qualquer outra coisa (ou nada) deixa o menu aberto", () => {
    expect(parseSidebarState(undefined)).toBe("expanded");
    expect(parseSidebarState("")).toBe("expanded");
    expect(parseSidebarState("Collapsed")).toBe("expanded");
    expect(parseSidebarState("<script>")).toBe("expanded");
  });
});
