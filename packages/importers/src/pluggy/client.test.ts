// O endereço da API (PLUGGY_API_URL): lido com new URL, protocolo por lista permitida e barras do
// fim tiradas sem regex. O CodeQL acusou o replace(/\/+$/) do M09.1 (js/polynomial-redos): com
// muitas "/" seguidas de outro caractere, o tempo crescia com o quadrado do tamanho.
import { describe, expect, it } from "vitest";
import { normalizeBaseUrl } from "./client";

describe("normalizeBaseUrl", () => {
  it("tira as barras do fim e mantém o caminho", () => {
    expect(normalizeBaseUrl("https://api.pluggy.ai")).toBe("https://api.pluggy.ai");
    expect(normalizeBaseUrl("https://api.pluggy.ai///")).toBe("https://api.pluggy.ai");
    expect(normalizeBaseUrl("http://127.0.0.1:8787/")).toBe("http://127.0.0.1:8787");
    expect(normalizeBaseUrl("http://proxy.test/pluggy//")).toBe("http://proxy.test/pluggy");
  });

  it("aceita só http: e https: (lista permitida)", () => {
    for (const bad of [
      "ftp://api.pluggy.ai",
      "file:///etc/passwd",
      "javascript:alert(1)",
      "api.pluggy.ai",
    ]) {
      expect(() => normalizeBaseUrl(bad), bad).toThrow(/PLUGGY_API_URL/);
    }
  });

  it("não guarda usuário, senha, consulta ou âncora no endereço", () => {
    expect(() => normalizeBaseUrl("https://user:pass@api.pluggy.ai")).toThrow(/PLUGGY_API_URL/);
    expect(normalizeBaseUrl("https://api.pluggy.ai/?x=1#y")).toBe("https://api.pluggy.ai");
  });

  it("é linear: 100 mil barras seguidas de outro caractere terminam na hora", () => {
    const evil = `http://a.test/${"/".repeat(100_000)}x`;
    const started = performance.now();
    expect(normalizeBaseUrl(evil).endsWith("x")).toBe(true);
    expect(normalizeBaseUrl(`http://a.test${"/".repeat(100_000)}`)).toBe("http://a.test");
    expect(performance.now() - started).toBeLessThan(500);
  });
});
