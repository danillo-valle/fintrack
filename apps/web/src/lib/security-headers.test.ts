import { describe, expect, it } from "vitest";
import { buildCsp, createNonce, STATIC_SECURITY_HEADERS } from "./security-headers";

/** Separa a CSP em { diretiva: [valores] } para os testes lerem uma diretiva de cada vez. */
function parse(csp: string): Record<string, string[]> {
  return Object.fromEntries(
    csp.split("; ").map((part) => {
      const [name = "", ...values] = part.split(" ");
      return [name, values];
    }),
  );
}

describe("buildCsp", () => {
  const prod = parse(buildCsp({ nonce: "abc123", dev: false, https: true }));
  const dev = parse(buildCsp({ nonce: "abc123", dev: true, https: false }));

  it("só deixa rodar script com o nonce da requisição", () => {
    expect(prod["script-src"]).toContain("'nonce-abc123'");
    expect(prod["script-src"]).toContain("'strict-dynamic'");
    // 'unsafe-inline' em script anularia a proteção inteira
    expect(prod["script-src"]).not.toContain("'unsafe-inline'");
  });

  it("proíbe eval em produção e libera só em desenvolvimento", () => {
    expect(prod["script-src"]).not.toContain("'unsafe-eval'");
    expect(dev["script-src"]).toContain("'unsafe-eval'");
  });

  it("libera o WebSocket do recarregamento só em desenvolvimento", () => {
    expect(prod["connect-src"]).toEqual(["'self'"]);
    expect(dev["connect-src"]).toContain("ws:");
  });

  it("não deixa o FinTrack ser colocado num iframe nem carregar plugins", () => {
    expect(prod["frame-ancestors"]).toEqual(["'none'"]);
    expect(prod["object-src"]).toEqual(["'none'"]);
    expect(prod["base-uri"]).toEqual(["'none'"]);
  });

  it("aceita imagem data: (o QR code do 2FA é gerado assim)", () => {
    expect(prod["img-src"]).toContain("data:");
  });

  it("pede HTTPS para tudo só quando o app está em HTTPS", () => {
    expect(prod).toHaveProperty("upgrade-insecure-requests");
    // Em http://localhost, essa diretiva quebraria o carregamento dos arquivos
    expect(dev).not.toHaveProperty("upgrade-insecure-requests");
  });

  it("não tem quebra de linha (cabeçalho HTTP inválido)", () => {
    expect(buildCsp({ nonce: "x", dev: false, https: true })).not.toMatch(/[\r\n]/);
  });
});

describe("createNonce", () => {
  it("gera 16 bytes em base64 (24 caracteres)", () => {
    expect(createNonce()).toMatch(/^[A-Za-z0-9+/]{22}==$/);
  });

  it("nunca repete (sorteia de novo a cada chamada)", () => {
    const nonces = new Set(Array.from({ length: 1000 }, () => createNonce()));
    expect(nonces.size).toBe(1000);
  });
});

describe("STATIC_SECURITY_HEADERS", () => {
  const byName = Object.fromEntries(STATIC_SECURITY_HEADERS.map((h) => [h.key, h.value]));

  it("inclui nosniff, política de referência e bloqueio de iframe", () => {
    expect(byName["X-Content-Type-Options"]).toBe("nosniff");
    expect(byName["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
    expect(byName["X-Frame-Options"]).toBe("DENY");
  });

  it("desliga câmera, microfone e localização", () => {
    expect(byName["Permissions-Policy"]).toContain("camera=()");
    expect(byName["Permissions-Policy"]).toContain("geolocation=()");
  });
});
