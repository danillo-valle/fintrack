import { describe, expect, it } from "vitest";
import {
  hasOriginText,
  installmentSiblingKey,
  installmentStem,
  sameText,
  shownText,
} from "./label";

describe("O que foi (M13.2)", () => {
  it("em destaque: o O que foi quando há; senão a descrição", () => {
    expect(shownText({ label: "Sapato da Zara", description: "MERCADOLIVRE*MERCA03/03" })).toBe(
      "Sapato da Zara",
    );
    expect(shownText({ label: null, description: "Padaria" })).toBe("Padaria");
  });

  it("textos iguais sem acento, caixa e pontuação", () => {
    expect(sameText("Café da Manhã!", "CAFE DA MANHA")).toBe(true);
    expect(sameText("Café", "Padaria")).toBe(false);
  });

  it("a parcela sem o número dela", () => {
    expect(installmentStem("MERCADOLIVRE*MERCA03/03")).toBe("MERCADOLIVRE*MERCA");
    expect(installmentStem("Leiturinha S.A 12/12")).toBe("Leiturinha S.A");
    expect(installmentStem("LOJA X 3 de 10")).toBe("LOJA X");
    expect(installmentStem("PADARIA")).toBe("PADARIA");
    expect(installmentStem("LOJA 03/10   ")).toBe("LOJA");
  });

  it("um texto cheio de espaços e números não deixa a conta lenta", () => {
    const hostile = `${"1 ".repeat(50_000)}x${" ".repeat(50_000)}`;
    const start = performance.now();
    expect(installmentStem(hostile)).toBe(hostile.trim());
    expect(performance.now() - start).toBeLessThan(200);
  });

  it("as parcelas da mesma compra têm a mesma chave; outra compra, outra chave", () => {
    const base = { accountId: "master", amount: -9764n, installmentCount: 3 };
    const p1 = installmentSiblingKey({ ...base, description: "MERCADOLIVRE*MERCA01/03" });
    const p3 = installmentSiblingKey({ ...base, description: "MERCADOLIVRE*MERCA03/03" });
    expect(p1).not.toBeNull();
    expect(p1).toBe(p3);
    expect(
      installmentSiblingKey({ ...base, amount: -100n, description: "MERCADOLIVRE*MERCA01/03" }),
    ).not.toBe(p1);
    expect(
      installmentSiblingKey({ ...base, installmentCount: null, description: "X 01/03" }),
    ).toBeNull();
  });
});

describe("texto de origem", () => {
  it("banco, OFX e PDF têm texto de origem; o manual e o bot, não", () => {
    expect(["OPEN_FINANCE", "OFX", "PDF"].map(hasOriginText)).toEqual([true, true, true]);
    expect(["MANUAL", "BOT", "RECURRENCE"].map(hasOriginText)).toEqual([false, false, false]);
  });
});
