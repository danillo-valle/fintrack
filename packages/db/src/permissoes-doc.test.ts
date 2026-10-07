// Mantém docs/permissoes.md honesto: as duas tabelas do documento precisam dizer exatamente
// o que as matrizes do código dizem (WALLET_MATRIX e HOUSEHOLD_MATRIX, do @fintrack/core).
// Mesma ideia do docs-sync.test.ts do M04: documentação que não é conferida envelhece calada.
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  HOUSEHOLD_ACTIONS,
  HOUSEHOLD_MATRIX,
  WALLET_ACTIONS,
  WALLET_MATRIX,
  WALLET_ROLES,
} from "@fintrack/core";
import { describe, expect, it } from "vitest";

const DOC = readFileSync(path.join(import.meta.dirname, "../../../docs/permissoes.md"), "utf8");

/** As linhas da tabela entre os marcadores, como { ação: [célula, célula, ...] }. */
function table(marker: string): Record<string, string[]> {
  const block = DOC.split(`<!-- ${marker}: início -->`)[1]?.split(`<!-- ${marker}: fim -->`)[0];
  if (!block) throw new Error(`marcadores de ${marker} não encontrados em docs/permissoes.md`);
  const rows = block
    .split("\n")
    .filter((line) => line.startsWith("|") && !line.includes("---"))
    .slice(1) // cabeçalho
    .map((line) =>
      line
        .split("|")
        .slice(1, -1)
        .map((cell) => cell.trim()),
    );
  return Object.fromEntries(rows.map(([action = "", ...cells]) => [action, cells]));
}

describe("docs/permissoes.md", () => {
  const wallet = table("matriz-carteira");
  const household = table("matriz-lar");

  it("a tabela da carteira tem uma linha por ação, nem mais nem menos", () => {
    expect(Object.keys(wallet).sort()).toEqual([...WALLET_ACTIONS].sort());
  });

  it.each(WALLET_ACTIONS)("carteira · %s bate com WALLET_MATRIX", (action) => {
    const rule = WALLET_MATRIX[action];
    const expected = WALLET_ROLES.map((role) =>
      rule[role] ? (rule.sharedOnly ? "só compartilhada" : "sim") : "não",
    );
    expect(wallet[action]).toEqual(expected);
  });

  it("a tabela do lar tem uma linha por ação", () => {
    expect(Object.keys(household).sort()).toEqual([...HOUSEHOLD_ACTIONS].sort());
  });

  it.each(HOUSEHOLD_ACTIONS)("lar · %s bate com HOUSEHOLD_MATRIX", (action) => {
    const rule = HOUSEHOLD_MATRIX[action];
    expect(household[action]).toEqual([rule.OWNER ? "sim" : "não", rule.MEMBER ? "sim" : "não"]);
  });
});
