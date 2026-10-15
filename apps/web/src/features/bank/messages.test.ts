import { describe, expect, it } from "vitest";
import { ofxErrorMessage, providerErrorMessage, syncErrorShort } from "./messages";

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

  it("arquivo recusado: frase própria para cada código do OFX", () => {
    const codes = [
      "OFX_EMPTY",
      "OFX_TOO_LARGE",
      "OFX_NOT_RECOGNIZED",
      "OFX_NO_STATEMENT",
      "OFX_MULTIPLE_ACCOUNTS",
      "OFX_NOT_BRL",
      "OFX_BAD_DATA",
    ];
    const sentences = codes.map(ofxErrorMessage);
    for (const sentence of sentences) expect(sentence).not.toMatch(/OFX_|undefined/);
    expect(new Set(sentences).size).toBe(codes.length);
    expect(ofxErrorMessage("QUALQUER")).toBe("Não deu para ler o arquivo. Tente de novo.");
  });
});
