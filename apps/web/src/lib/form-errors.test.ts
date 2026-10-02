import { describe, expect, it } from "vitest";
import { messageFor, type InputLike } from "./form-errors";

function input(overrides: Partial<InputLike>): InputLike {
  return {
    type: "text",
    value: "",
    required: false,
    minLength: -1,
    maxLength: -1,
    pattern: "",
    dataset: {},
    labels: [{ textContent: "E-mail" }],
    ...overrides,
  };
}

describe("messageFor", () => {
  it("campo obrigatório vazio: usa o rótulo, em português", () => {
    expect(messageFor(input({ required: true }))).toBe("Preencha o campo E-mail.");
    expect(messageFor(input({ required: true, value: "   " }))).toBe("Preencha o campo E-mail.");
  });

  it("mensagem própria do campo vence a padrão", () => {
    const code = input({ required: true, dataset: { msgMissing: "Digite o código." } });
    expect(messageFor(code)).toBe("Digite o código.");
  });

  it("e-mail sem @ ou sem domínio", () => {
    expect(messageFor(input({ type: "email", value: "ana" }))).toMatch(/nome@exemplo\.com/);
    expect(messageFor(input({ type: "email", value: "ana@casa" }))).toMatch(/nome@exemplo\.com/);
    expect(messageFor(input({ type: "email", value: "ana@casa.com" }))).toBeNull();
  });

  it("tamanho mínimo e máximo", () => {
    expect(messageFor(input({ value: "1234567", minLength: 8 }))).toBe(
      "Use pelo menos 8 caracteres.",
    );
    expect(messageFor(input({ value: "12345678", minLength: 8 }))).toBeNull();
    expect(messageFor(input({ value: "abc", maxLength: 2 }))).toBe("Use no máximo 2 caracteres.");
  });

  it("pattern vale para o valor inteiro, como no HTML", () => {
    const totp = input({
      pattern: "[0-9 ]{6,7}",
      dataset: { msgPattern: "O código tem 6 números." },
    });
    expect(messageFor({ ...totp, value: "12ab" })).toBe("O código tem 6 números.");
    expect(messageFor({ ...totp, value: "123456" })).toBeNull();
    expect(messageFor({ ...totp, value: "123 456" })).toBeNull();
    expect(messageFor({ ...totp, value: "1234567890" })).toBe("O código tem 6 números.");
  });

  it("campo opcional vazio não tem erro", () => {
    expect(messageFor(input({ type: "email", minLength: 8 }))).toBeNull();
  });
});
