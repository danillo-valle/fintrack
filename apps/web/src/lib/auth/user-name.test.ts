import { describe, expect, it } from "vitest";
import { cleanUserName } from "./user-name";

describe("cleanUserName", () => {
  it("limpa o nome (M12.4a)", () => {
    expect(cleanUserName("  Lia\u0000 Exemplo\u202e ")).toBe("Lia Exemplo");
  });

  it("recusa um nome que só tem invisíveis", () => {
    expect(() => cleanUserName("\u0000\u200b ")).toThrow("Digite o seu nome.");
  });
});
