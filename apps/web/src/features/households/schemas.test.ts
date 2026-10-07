// Casos válidos e inválidos das entradas do lar. O servidor confia só no que passa daqui.
import { describe, expect, it } from "vitest";
import { createHouseholdSchema, inviteIdSchema, inviteSchema, inviteTokenSchema } from "./schemas";

describe("createHouseholdSchema", () => {
  it("tira espaços das pontas", () => {
    expect(createHouseholdSchema.parse({ name: "  Casa Exemplo  " })).toEqual({
      name: "Casa Exemplo",
    });
  });

  it.each([
    ["", "Dê um nome ao lar."],
    ["    ", "Dê um nome ao lar."],
    ["x".repeat(61), "Use no máximo 60 caracteres."],
  ])("recusa %j com a mensagem certa", (name, message) => {
    const result = createHouseholdSchema.safeParse({ name });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe(message);
  });
});

describe("inviteSchema", () => {
  it("normaliza o e-mail e usa MEMBER como papel padrão", () => {
    expect(inviteSchema.parse({ email: "  Esposa@Exemplo.COM " })).toEqual({
      email: "esposa@exemplo.com",
      role: "MEMBER",
    });
  });

  it("aceita convidar como dono do lar", () => {
    expect(inviteSchema.parse({ email: "a@b.co", role: "OWNER" }).role).toBe("OWNER");
  });

  it.each(["", "sem-arroba", "a@", "@b.com", "a b@c.com"])("recusa o e-mail %j", (email) => {
    expect(inviteSchema.safeParse({ email }).success).toBe(false);
  });

  it("recusa papel inventado (o formulário pode ser editado no navegador)", () => {
    expect(inviteSchema.safeParse({ email: "a@b.co", role: "ADMIN" }).success).toBe(false);
  });
});

describe("ids e segredo", () => {
  it("inviteId precisa ser UUID", () => {
    expect(
      inviteIdSchema.safeParse({ inviteId: "0199b5c2-7d0e-7a3b-8c1d-2e3f4a5b6c7d" }).success,
    ).toBe(true);
    expect(inviteIdSchema.safeParse({ inviteId: "1; DROP TABLE" }).success).toBe(false);
  });

  it("segredo do convite: 43 caracteres de base64url", () => {
    expect(inviteTokenSchema.safeParse({ token: "A".repeat(43) }).success).toBe(true);
    expect(inviteTokenSchema.safeParse({ token: "A".repeat(42) }).success).toBe(false);
    expect(inviteTokenSchema.safeParse({ token: `${"A".repeat(42)}=` }).success).toBe(false);
  });
});
