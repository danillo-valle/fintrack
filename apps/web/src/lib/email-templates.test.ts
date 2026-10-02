import { describe, expect, it } from "vitest";
import { passwordChangedEmail, resetPasswordEmail, verificationEmail } from "./email-templates";

describe("e-mails", () => {
  it("o e-mail de verificação traz o link no texto e no HTML", () => {
    const url = "http://localhost:3000/api/auth/verify-email?token=abc";
    const mail = verificationEmail("Ana", url);
    expect(mail.subject).toBe("Confirme seu e-mail no FinTrack");
    expect(mail.text).toContain(url);
    expect(mail.html).toContain('href="http://localhost:3000/api/auth/verify-email?token=abc"');
  });

  it("escapa o nome no HTML: um nome com tags não vira código", () => {
    const mail = resetPasswordEmail('<img src=x onerror="alert(1)">', "http://x.test/r");
    expect(mail.html).not.toContain("<img");
    expect(mail.html).toContain("&lt;img");
  });

  it("o aviso de senha trocada diz quando e aponta para o esqueci a senha", () => {
    const mail = passwordChangedEmail(
      "Ana",
      "30/09/2026, 22:00",
      "http://localhost:3000/esqueci-a-senha",
    );
    expect(mail.subject).toBe("Sua senha do FinTrack foi trocada");
    expect(mail.text).toContain("30/09/2026, 22:00");
    expect(mail.text).toContain("Se não foi você");
    expect(mail.html).toContain('href="http://localhost:3000/esqueci-a-senha"');
  });
});
