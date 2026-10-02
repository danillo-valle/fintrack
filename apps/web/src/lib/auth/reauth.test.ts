import { describe, expect, it } from "vitest";
import { isRecentlyAuthenticated, isSensitiveAuthPath, REAUTH_WINDOW_MS } from "./reauth";

const now = new Date("2026-10-01T12:00:00Z");
const minutesAgo = (m: number) => new Date(now.getTime() - m * 60_000);

describe("isRecentlyAuthenticated", () => {
  it("um login de agora há pouco vale como prova", () => {
    expect(isRecentlyAuthenticated({ createdAt: minutesAgo(2) }, now)).toBe(true);
  });

  it("um login antigo não vale", () => {
    expect(isRecentlyAuthenticated({ createdAt: minutesAgo(60) }, now)).toBe(false);
  });

  it("uma reautenticação recente renova a prova de um login antigo", () => {
    const session = { createdAt: minutesAgo(600), reauthenticatedAt: minutesAgo(3) };
    expect(isRecentlyAuthenticated(session, now)).toBe(true);
  });

  it("vale até o limite exato da janela, e não depois", () => {
    const limit = new Date(now.getTime() - REAUTH_WINDOW_MS);
    expect(isRecentlyAuthenticated({ createdAt: limit }, now)).toBe(true);
    expect(isRecentlyAuthenticated({ createdAt: new Date(limit.getTime() - 1) }, now)).toBe(false);
  });

  it("uma data no futuro não conta", () => {
    expect(isRecentlyAuthenticated({ createdAt: minutesAgo(-5) }, now)).toBe(false);
  });

  it("aceita datas como texto (como chegam do banco em JSON)", () => {
    expect(isRecentlyAuthenticated({ createdAt: minutesAgo(1).toISOString() }, now)).toBe(true);
  });
});

describe("isSensitiveAuthPath", () => {
  it("cadastrar passkey e desligar o 2FA são sensíveis; entrar não é", () => {
    expect(isSensitiveAuthPath("/passkey/generate-register-options")).toBe(true);
    expect(isSensitiveAuthPath("/two-factor/disable")).toBe(true);
    expect(isSensitiveAuthPath("/sign-in/email")).toBe(false);
    expect(isSensitiveAuthPath(undefined)).toBe(false);
  });

  it("trocar a senha não pede reautenticação: o endpoint já exige a senha atual", () => {
    expect(isSensitiveAuthPath("/change-password")).toBe(false);
  });
});
