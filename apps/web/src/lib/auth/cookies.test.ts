// Os cookies do login com as opções DE VERDADE do auth.ts (M12.1): o E2E roda em
// http://localhost, onde o navegador não aceitaria Secure; aqui se confere também o HTTPS da
// produção, com a mesma função do Better Auth que grava os cookies.
import { createCookieGetter, getCookies } from "better-auth/cookies";
import { describe, expect, it } from "vitest";
import { AUTH_ADVANCED, AUTH_SESSION, TWO_FACTOR_PENDING_COOKIES } from "./cookies";

const cookiesFor = (baseURL: string) =>
  getCookies({ baseURL, advanced: AUTH_ADVANCED, session: AUTH_SESSION });

describe("cookie da sessão", () => {
  it("em HTTPS (produção): Secure, prefixo __Secure-, HttpOnly, SameSite=Lax, Path=/", () => {
    const { sessionToken } = cookiesFor("https://fintrack.exemplo.test");
    expect(sessionToken.name).toBe("__Secure-fintrack.session_token");
    expect(sessionToken.attributes).toMatchObject({
      secure: true,
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: AUTH_SESSION.expiresIn,
    });
    // Sem Domain: o cookie vale só para o endereço exato do app, não para outros subdomínios
    expect(sessionToken.attributes.domain).toBeUndefined();
  });

  it("em http://localhost (desenvolvimento): sem Secure, o resto igual", () => {
    const { sessionToken } = cookiesFor("http://localhost:3000");
    expect(sessionToken.name).toBe("fintrack.session_token");
    expect(sessionToken.attributes).toMatchObject({
      secure: false,
      httpOnly: true,
      sameSite: "lax",
    });
  });
});

describe("cookie do 2FA pendente", () => {
  it("a tela do código procura os dois nomes que o Better Auth usa (http e https)", () => {
    // O plugin twoFactor grava o cookie "two_factor" pelo mesmo gerador de nomes
    const name = (url: string) =>
      createCookieGetter({ baseURL: url, advanced: AUTH_ADVANCED })("two_factor").name;
    expect([...TWO_FACTOR_PENDING_COOKIES].sort()).toEqual(
      [name("http://localhost:3000"), name("https://fintrack.exemplo.test")].sort(),
    );
  });
});
