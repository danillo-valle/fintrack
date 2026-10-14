import { describe, expect, it } from "vitest";
import { providerErrorMessage, syncErrorShort } from "./messages";

describe("mensagens da coleta bancária", () => {
  it("cada código tem frase própria, sem detalhe técnico", () => {
    for (const code of [
      "PROVIDER_AUTH_FAILED",
      "PROVIDER_NOT_FOUND",
      "PROVIDER_RATE_LIMITED",
      "PROVIDER_UNAVAILABLE",
      "PROVIDER_BAD_RESPONSE",
      "SYNC_FAILED",
    ]) {
      expect(providerErrorMessage(code)).not.toMatch(/PROVIDER_|undefined/);
      expect(syncErrorShort(code)).not.toMatch(/PROVIDER_|undefined/);
    }
    expect(providerErrorMessage("QUALQUER")).toBe("A busca não terminou. Tente de novo.");
  });

  it("chave do servidor errada ou ausente: a tela diz o que fazer, sem o nome técnico", () => {
    for (const code of [
      "CONNECTION_SECRET_UNREADABLE",
      "CONNECTION_SECRET_REQUIRED",
      "CONNECTION_KEY_MISSING",
    ]) {
      expect(syncErrorShort(code)).not.toMatch(/CONNECTION_|erro do FinTrack/);
    }
  });
});
