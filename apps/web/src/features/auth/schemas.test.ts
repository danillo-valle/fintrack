import { describe, expect, it } from "vitest";
import { reauthSchema } from "./schemas";

describe("reauthSchema", () => {
  it("aceita senha", () => {
    const result = reauthSchema.parse({ method: "password", password: "uma frase longa" });
    expect(result).toMatchObject({ method: "password", next: "/" });
  });

  it("aceita código de 6 números, com ou sem espaço", () => {
    expect(reauthSchema.parse({ method: "totp", code: "123 456" })).toMatchObject({
      code: "123456",
    });
  });

  it("recusa código com letras ou tamanho errado", () => {
    expect(reauthSchema.safeParse({ method: "totp", code: "12345a" }).success).toBe(false);
    expect(reauthSchema.safeParse({ method: "totp", code: "12345" }).success).toBe(false);
  });

  it("recusa senha vazia e método desconhecido", () => {
    expect(reauthSchema.safeParse({ method: "password", password: "" }).success).toBe(false);
    expect(reauthSchema.safeParse({ method: "sms", code: "123456" }).success).toBe(false);
  });
});
