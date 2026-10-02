import { describe, expect, it } from "vitest";
import { authErrorMessage, isCancelled } from "./messages";

describe("authErrorMessage", () => {
  it("traduz os códigos do Better Auth", () => {
    expect(authErrorMessage({ code: "INVALID_EMAIL_OR_PASSWORD" })).toBe(
      "E-mail ou senha incorretos.",
    );
    expect(authErrorMessage({ code: "SIGNUP_NOT_ALLOWED" })).toMatch(/não está autorizado/);
  });

  it("limite de tentativas vira uma instrução, qualquer que seja o código", () => {
    expect(authErrorMessage({ status: 429, code: "X" })).toMatch(/Espere um minuto/);
  });

  it("conta sem senha (só Google) recebe uma saída em vez de erro genérico", () => {
    expect(authErrorMessage({ code: "CREDENTIAL_ACCOUNT_NOT_FOUND" })).toMatch(/Esqueci a senha/);
  });

  it("nunca mostra a mensagem crua em inglês", () => {
    expect(authErrorMessage({ code: "ALGO_NOVO", message: "Internal details" })).toBe(
      "Algo deu errado. Tente de novo em instantes.",
    );
    expect(authErrorMessage(null)).toMatch(/Algo deu errado/);
  });
});

describe("isCancelled", () => {
  it("reconhece quando a pessoa fechou a janela da passkey", () => {
    expect(isCancelled({ code: "AUTH_CANCELLED" })).toBe(true);
    expect(isCancelled({ code: "INVALID_CODE" })).toBe(false);
    expect(isCancelled(null)).toBe(false);
  });
});
