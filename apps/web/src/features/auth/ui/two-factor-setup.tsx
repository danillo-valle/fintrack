"use client";

import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { ArrowRight, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { authClient } from "@/lib/auth-client";
import { navigateAfterAuthChange } from "@/lib/navigation";
import { authErrorMessage } from "@/lib/auth/messages";
import { BackupCodes } from "./backup-codes";
import { FormAlert } from "./form-alert";
import { PasswordInput } from "./password-input";

type Step =
  | { name: "password" }
  | { name: "scan"; totpURI: string; secret: string; qr: string; backupCodes: string[] }
  | { name: "codes"; backupCodes: string[] };

/** Tira o segredo (a "chave") do endereço otpauth://, para quem prefere digitar no app */
function secretFrom(totpURI: string): string {
  return new URL(totpURI).searchParams.get("secret") ?? "";
}

// Liga o 2FA em três passos: confirmar a senha → ler o QR code → guardar os códigos de backup.
// Enquanto o 2FA não está ligado, o app não mostra nenhuma outra tela (requireUser).
export function TwoFactorSetup() {
  const [step, setStep] = useState<Step>({ name: "password" });
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [saved, setSaved] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);

  // A cada passo novo, o foco vai para o título do passo: o leitor de tela anuncia onde a pessoa está
  useEffect(() => {
    if (step.name !== "password") headingRef.current?.focus();
  }, [step.name]);

  async function confirmPassword(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    const { data, error } = await authClient.twoFactor.enable({
      password: String(new FormData(event.currentTarget).get("password") ?? ""),
    });
    setPending(false);
    // "method" separa o 2FA por app (totp) do 2FA por e-mail (otp), que o FinTrack não usa
    if (error || !data || data.method !== "totp") {
      setError(authErrorMessage(error));
      return;
    }
    const qr = await QRCode.toDataURL(data.totpURI, { margin: 1, width: 220 });
    setStep({
      name: "scan",
      totpURI: data.totpURI,
      secret: secretFrom(data.totpURI),
      qr,
      backupCodes: data.backupCodes,
    });
  }

  async function verifyCode(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (step.name !== "scan") return;
    setPending(true);
    setError(null);
    const code = String(new FormData(event.currentTarget).get("code") ?? "").replace(/\s/g, "");
    const { error } = await authClient.twoFactor.verifyTotp({ code });
    setPending(false);
    if (error) {
      setError(authErrorMessage(error));
      return;
    }
    setStep({ name: "codes", backupCodes: step.backupCodes });
  }

  if (step.name === "password") {
    return (
      <>
        <FormAlert message={error} />
        <form onSubmit={confirmPassword}>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="password">Confirme sua senha</FieldLabel>
              <PasswordInput
                id="password"
                name="password"
                autoComplete="current-password"
                required
              />
            </Field>
            <Button type="submit" size="lg" className="h-11" disabled={pending}>
              <ArrowRight aria-hidden />
              {pending ? "Preparando…" : "Continuar"}
            </Button>
          </FieldGroup>
        </form>
      </>
    );
  }

  if (step.name === "scan") {
    return (
      <>
        <h2 ref={headingRef} tabIndex={-1} className="mb-2 font-semibold outline-none">
          Passo 2 de 3: ler o QR code
        </h2>
        <p className="text-muted-foreground mb-4 text-sm">
          Serve qualquer app de códigos de 6 dígitos: o app Senhas do iPhone e do Mac, Google
          Authenticator, Microsoft Authenticator, 1Password, Bitwarden, Authy ou outro. No app,
          toque em adicionar e aponte a câmera para o código.
        </p>
        {/* Fundo branco fixo: o leitor de QR precisa de contraste, inclusive no tema escuro */}
        <div className="mb-4 flex justify-center rounded-lg bg-white p-3">
          {/* eslint-disable-next-line @next/next/no-img-element -- imagem gerada na hora, em data URL */}
          <img
            src={step.qr}
            width={220}
            height={220}
            alt="QR code para adicionar o FinTrack ao app autenticador"
          />
        </div>
        <details className="mb-4 text-sm">
          <summary className="focus-visible:ring-ring cursor-pointer rounded-sm outline-none focus-visible:ring-3">
            Não consegue ler? Digite a chave
          </summary>
          <p className="mt-2">
            Chave:{" "}
            <code data-testid="totp-secret" className="bg-muted rounded px-1 font-mono break-all">
              {step.secret}
            </code>
          </p>
        </details>
        <FormAlert message={error} />
        <form onSubmit={verifyCode}>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="code">Código de 6 números que aparece no app</FieldLabel>
              <Input
                id="code"
                name="code"
                autoComplete="one-time-code"
                inputMode="numeric"
                pattern="[0-9 ]{6,7}"
                maxLength={7}
                required
                className="tabular h-12 text-center text-lg tracking-[0.3em]"
              />
              <FieldDescription>O código muda a cada 30 segundos.</FieldDescription>
            </Field>
            <Button type="submit" size="lg" className="h-11" disabled={pending}>
              <ShieldCheck aria-hidden />
              {pending ? "Conferindo…" : "Ligar o 2FA"}
            </Button>
          </FieldGroup>
        </form>
      </>
    );
  }

  return (
    <>
      <h2 ref={headingRef} tabIndex={-1} className="mb-2 font-semibold outline-none">
        Passo 3 de 3: guardar os códigos de backup
      </h2>
      <p className="text-muted-foreground mb-4 text-sm">
        2FA ligado. Se perder o celular, cada código abaixo permite entrar uma vez. Guarde num
        gerenciador de senhas ou imprima. Eles não aparecem de novo.
      </p>
      <BackupCodes codes={step.backupCodes} />
      <label className="mt-6 flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          checked={saved}
          onChange={(event) => setSaved(event.target.checked)}
          className="accent-primary mt-0.5 size-4"
        />
        Guardei os códigos em um lugar seguro
      </label>
      <Button
        type="button"
        size="lg"
        className="mt-4 h-11 w-full"
        disabled={!saved}
        onClick={() => navigateAfterAuthChange("/")}
      >
        Ir para o FinTrack
        <ArrowRight aria-hidden />
      </Button>
    </>
  );
}
