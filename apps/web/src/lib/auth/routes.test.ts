import { describe, expect, it } from "vitest";
import { isPublicPath, safeNextPath, signInUrl } from "./routes";

describe("isPublicPath", () => {
  it("as telas de entrada e a API de autenticação são públicas", () => {
    for (const path of ["/entrar", "/cadastro", "/esqueci-a-senha", "/api/auth/sign-in/email"]) {
      expect(isPublicPath(path)).toBe(true);
    }
  });

  it("o health check, o manifesto e os ícones são públicos", () => {
    for (const path of ["/api/health", "/manifest.webmanifest", "/icons/icon-192.png"]) {
      expect(isPublicPath(path)).toBe(true);
    }
  });

  it("as páginas do app exigem sessão", () => {
    for (const path of ["/", "/lancamentos", "/ajustes/seguranca", "/configurar-2fa", "/dev/ui"]) {
      expect(isPublicPath(path)).toBe(false);
    }
  });

  it("um caminho que só começa parecido não vira público", () => {
    expect(isPublicPath("/entrar-falso")).toBe(false);
    expect(isPublicPath("/api/authx")).toBe(false);
  });
});

describe("safeNextPath (proteção contra open redirect)", () => {
  it("aceita caminhos internos, com busca", () => {
    expect(safeNextPath("/lancamentos")).toBe("/lancamentos");
    expect(safeNextPath("/lancamentos?mes=2026-10")).toBe("/lancamentos?mes=2026-10");
  });

  it("recusa endereços externos e truques conhecidos", () => {
    for (const bad of [
      "https://site-falso.com",
      "//site-falso.com",
      "/\\site-falso.com",
      "javascript:alert(1)",
      "lancamentos",
      "/\u0000x",
    ]) {
      expect(safeNextPath(bad)).toBe("/");
    }
  });

  it("sem destino, usa o padrão", () => {
    expect(safeNextPath(null, "/ajustes")).toBe("/ajustes");
  });
});

describe("signInUrl", () => {
  it("leva o destino junto, codificado", () => {
    expect(signInUrl("/lancamentos?mes=2026-10")).toBe(
      "/entrar?next=%2Flancamentos%3Fmes%3D2026-10",
    );
  });

  it("para a página inicial, não precisa de next", () => {
    expect(signInUrl("/")).toBe("/entrar");
  });
});
