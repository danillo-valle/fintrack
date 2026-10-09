import { describe, expect, it } from "vitest";
import { parseSidebarState, sidebarCookie } from "./state";

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

describe("sidebarCookie", () => {
  it("guarda a escolha por um ano, no site inteiro", () => {
    expect(sidebarCookie("collapsed")).toBe(
      "fintrack-sidebar=collapsed; path=/; max-age=31536000; samesite=lax",
    );
  });
});
