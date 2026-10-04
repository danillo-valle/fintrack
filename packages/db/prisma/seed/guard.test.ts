import { describe, expect, it } from "vitest";
import { checkSeedTarget } from "./guard";

const url = (host: string) => `postgresql://fintrack:senha@${host}:5432/fintrack`;

describe("checkSeedTarget", () => {
  it("libera banco local, como no M04", () => {
    for (const host of ["localhost", "127.0.0.1", "[::1]"]) {
      expect(checkSeedTarget({ DATABASE_URL: url(host) })).toMatchObject({ ok: true });
    }
  });

  it("recusa outro host sem a confirmação SEED_TARGET_HOST", () => {
    const result = checkSeedTarget({ DATABASE_URL: url("db") });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.reason).toContain("SEED_TARGET_HOST=db");
  });

  it("libera outro host quando a confirmação bate com o host do DATABASE_URL", () => {
    expect(checkSeedTarget({ DATABASE_URL: url("db"), SEED_TARGET_HOST: "db" })).toEqual({
      ok: true,
      host: "db",
    });
  });

  it("recusa quando a confirmação é de outro host (o .env aponta para o lugar errado)", () => {
    const result = checkSeedTarget({
      DATABASE_URL: url("banco-de-outra-coisa.exemplo.com"),
      SEED_TARGET_HOST: "db",
    });
    expect(result.ok).toBe(false);
  });

  it("recusa DATABASE_URL vazia ou inválida", () => {
    expect(checkSeedTarget({}).ok).toBe(false);
    expect(checkSeedTarget({ DATABASE_URL: "não é url" }).ok).toBe(false);
  });

  it("não mostra a senha do banco na mensagem de erro", () => {
    const result = checkSeedTarget({ DATABASE_URL: url("db") });
    expect(!result.ok && result.reason).not.toContain("senha");
  });
});
