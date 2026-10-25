import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildCsp,
  createNonce,
  INLINE_STYLE_HASHES,
  STATIC_SECURITY_HEADERS,
} from "./security-headers";

const require = createRequire(import.meta.url);

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

  it("<style> só com o nonce ou pelo hash exato; style= só como atributo (M12.1)", () => {
    // Produção: nenhum 'unsafe-inline' que valha para <style>, nem no padrão, nem na diretiva
    expect(prod["style-src"]).toEqual(["'self'"]);
    expect(prod["style-src-elem"]).not.toContain("'unsafe-inline'");
    expect(prod["style-src-elem"]).toContain("'nonce-abc123'");
    expect(prod["style-src-elem"]).toContain(`'${INLINE_STYLE_HASHES.sonner}'`);
    expect(prod["style-src-attr"]).toEqual(["'unsafe-inline'"]);
  });

  it("em dev, <style> liberado (o recarregamento do Next), sem nonce que o anularia", () => {
    expect(dev["style-src"]).toEqual(["'self'"]);
    expect(dev["style-src-elem"]).toEqual(["'self'", "'unsafe-inline'"]);
    expect(dev["style-src-attr"]).toEqual(["'unsafe-inline'"]);
  });

  it("o hash do sonner é o do CSS do pacote instalado (atualizou o sonner? troque o hash)", () => {
    // O sonner põe o CSS dele num <style> pelo __insertCSS("...") do dist/index.mjs
    const entry = require.resolve("sonner");
    const source = readFileSync(path.join(path.dirname(entry), "index.mjs"), "utf8");
    const literal = /__insertCSS\(("(?:[^"\\]|\\.)*")\)/.exec(source)?.[1];
    expect(literal, "o sonner mudou o jeito de injetar o CSS: reveja a CSP").toBeDefined();
    const css = JSON.parse(literal!) as string;
    const hash = `sha256-${createHash("sha256").update(css).digest("base64")}`;
    expect(INLINE_STYLE_HASHES.sonner, "hash novo do CSS do sonner").toBe(hash);
    expect(INLINE_STYLE_HASHES.empty).toBe(
      `sha256-${createHash("sha256").update("").digest("base64")}`,
    );
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
