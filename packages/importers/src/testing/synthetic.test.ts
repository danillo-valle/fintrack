import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { syntheticBank, toPluggyJson } from "./synthetic";

const RECORDED = path.resolve(
  import.meta.dirname,
  "../../fixtures/pluggy/banco-sintetico-2026-10-10.json",
);

describe("banco sintético (respostas gravadas)", () => {
  it("o gerador ainda produz exatamente as respostas gravadas de 2026-10-10", () => {
    const recorded = readFileSync(RECORDED, "utf8").trim();
    expect(toPluggyJson(syntheticBank("2026-10-10"))).toBe(recorded);
  });

  it("só dados sintéticos: finais 0001, 0002 e 0003 e bancos inventados", () => {
    const text = readFileSync(RECORDED, "utf8");
    expect(text).not.toMatch(/\d{13,19}/); // nada parecido com número de cartão inteiro
    for (const name of ["Banco Aurora", "Banco Exemplo"]) expect(text).toContain(name);
  });
});
