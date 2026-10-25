import { describe, expect, it, vi } from "vitest";
import { authPath, authSecurityEvent, logAuthResponse } from "./security-log";

describe("authSecurityEvent", () => {
  it.each([
    // Tentativas de entrar ou de provar identidade que não passaram
    ["/sign-in/email", 401, "INVALID_EMAIL_OR_PASSWORD", "auth.failed"],
    ["/two-factor/verify-totp", 401, "INVALID_CODE", "auth.failed"],
    ["/two-factor/verify-backup-code", 401, "INVALID_BACKUP_CODE", "auth.failed"],
    ["/passkey/verify-authentication", 400, null, "auth.failed"],
    ["/change-password", 400, "INVALID_PASSWORD", "auth.failed"],
    ["/reset-password", 400, "INVALID_TOKEN", "auth.failed"],
    // O limite de tentativas, em qualquer endpoint
    ["/sign-in/email", 429, null, "auth.rate_limited"],
    ["/request-password-reset", 429, null, "auth.rate_limited"],
    // Outra origem (CSRF), em qualquer endpoint
    ["/sign-out", 403, "INVALID_ORIGIN", "auth.origin_rejected"],
    ["/change-password", 403, "MISSING_OR_NULL_ORIGIN", "auth.origin_rejected"],
  ] as const)("%s %i %s → %s", (path, status, code, event) => {
    expect(authSecurityEvent(path, status, code)).toBe(event);
  });

  it.each([
    // O fluxo normal não é evento: sucesso, sessão ausente, reautenticação pedida pelo app
    ["/sign-in/email", 200, null],
    ["/get-session", 401, "UNAUTHORIZED"],
    ["/passkey/add-passkey", 403, "REAUTH_REQUIRED"],
    // Cadastro recusado responde como sucesso (anti-enumeração): nada a registrar
    ["/sign-up/email", 200, null],
    // Erro do servidor já sai como request.error
    ["/sign-in/email", 500, null],
  ] as const)("%s %i %s → nenhum", (path, status, code) => {
    expect(authSecurityEvent(path, status, code)).toBeNull();
  });
});

describe("authPath", () => {
  it("tira o /api/auth do começo e ignora a query", () => {
    expect(authPath("http://localhost:3000/api/auth/sign-in/email?x=1")).toBe("/sign-in/email");
  });
});

describe("logAuthResponse", () => {
  const request = (body = "{}") =>
    new Request("http://localhost:3000/api/auth/sign-in/email", {
      method: "POST",
      headers: { "x-forwarded-for": "203.0.113.7", "content-type": "application/json" },
      body,
    });

  it("grava o evento com caminho, status, código e IP; nunca o corpo do pedido", async () => {
    const warn = vi.fn();
    const response = Response.json(
      { code: "INVALID_EMAIL_OR_PASSWORD", message: "Invalid email or password" },
      { status: 401 },
    );
    const returned = await logAuthResponse(
      request('{"email":"ana@exemplo.test","password":"segredo"}'),
      response,
      { warn },
    );
    expect(returned).toBe(response);
    // A resposta continua legível para o navegador (o código leu uma cópia)
    expect(await returned.json()).toMatchObject({ code: "INVALID_EMAIL_OR_PASSWORD" });
    expect(warn).toHaveBeenCalledOnce();
    const [fields] = warn.mock.calls[0]!;
    expect(fields).toEqual({
      event: "auth.failed",
      path: "/sign-in/email",
      status: 401,
      code: "INVALID_EMAIL_OR_PASSWORD",
      ip: "203.0.113.7",
    });
    expect(JSON.stringify(warn.mock.calls)).not.toMatch(/ana@|segredo/);
  });

  it("o 429 do limite (corpo sem código) também vira evento", async () => {
    const warn = vi.fn();
    const response = new Response('{"message":"Too many requests."}', { status: 429 });
    await logAuthResponse(request(), response, { warn });
    expect(warn.mock.calls[0]![0]).toMatchObject({ event: "auth.rate_limited", code: null });
  });

  it("um código fora do formato não vai para o log", async () => {
    const warn = vi.fn();
    const response = Response.json({ code: "texto livre <script>" }, { status: 401 });
    await logAuthResponse(request(), response, { warn });
    expect(warn.mock.calls[0]![0]).toMatchObject({ event: "auth.failed", code: null });
  });

  it("resposta de sucesso: nada gravado", async () => {
    const warn = vi.fn();
    await logAuthResponse(request(), Response.json({ ok: true }), { warn });
    expect(warn).not.toHaveBeenCalled();
  });
});
