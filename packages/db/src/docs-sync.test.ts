// Mantém o diagrama de docs/modelo-de-dados.md honesto: todo modelo do schema precisa
// aparecer no diagrama Mermaid. Documentação que não é conferida envelhece calada.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SCHEMA_DIR = path.join(import.meta.dirname, "../prisma/schema");
const DOC = path.join(import.meta.dirname, "../../../docs/modelo-de-dados.md");

// As tabelas do Better Auth (login) ficam fora do diagrama do domínio, exceto o User
const AUTH_ONLY = new Set([
  "Session",
  "Account",
  "Verification",
  "TwoFactor",
  "Passkey",
  "RateLimit",
]);

function schemaModels(): string[] {
  return readdirSync(SCHEMA_DIR)
    .filter((file) => file.endsWith(".prisma"))
    .flatMap((file) => [
      ...readFileSync(path.join(SCHEMA_DIR, file), "utf8").matchAll(/^model (\w+) \{/gm),
    ])
    .map((match) => match[1] ?? "")
    .filter((name) => !AUTH_ONLY.has(name));
}

describe("docs/modelo-de-dados.md", () => {
  const doc = readFileSync(DOC, "utf8");
  const models = schemaModels();

  it("o teste encontrou os modelos do domínio", () => {
    expect(models.length).toBeGreaterThanOrEqual(15);
  });

  it.each(models)("o diagrama mostra o modelo %s", (model) => {
    expect(doc).toMatch(new RegExp(`\\b${model}\\b`));
  });
});
