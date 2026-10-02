"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { LogIn, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { authClient } from "@/lib/auth-client";
import { authErrorMessage } from "@/lib/auth/messages";
import { signInUrl } from "@/lib/auth/routes";
import { useFieldErrors } from "@/lib/use-field-errors";
import { FormAlert } from "./form-alert";

type Mode = "totp" | "backup";

// O que muda entre os dois modos: rótulo, ajuda, mensagens e o tipo de teclado.
// A página tem um subtítulo neutro; quem fala do app ou do backup é o próprio campo.
const MODES = {
  totp: {
    label: "Código do app autenticador",
    help: "Abra o app autenticador (ou o app Senhas do iPhone e do Mac) e digite os 6 números do FinTrack.",
    missing: "Digite o código de 6 números do app.",
    switchTo: "Usar um código de backup",
  },
  backup: {
    label: "Código de backup",
    help: "Use um dos códigos que você guardou ao ligar o 2FA. Cada um vale uma vez.",
    missing: "Digite um dos seus códigos de backup.",
    switchTo: "Usar o app autenticador",
  },
} as const;

// Segundo passo do login: o código de 6 dígitos do app autenticador (ou um código de backup).
// A sessão só é criada quando este código confere.
export function TwoFactorForm({ next }: { next: string }) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("totp");
  const [error, setError] = useState<string | null>(null);
  // A senha foi digitada há mais de 10 minutos (ou em outra aba): outro código não resolve
  const [expired, setExpired] = useState(false);
  const [pending, setPending] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const { errors, validate, fieldProps, errorId, clear } = useFieldErrors();
  const text = MODES[mode];

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    // Vazio ou fora do formato: o aviso aparece embaixo do campo, que recebe o foco
    if (!validate(event.currentTarget)) return;
    // Espaços são aceitos ("123 456") e removidos aqui. O hífen fica: ele faz parte do código de backup
    const code = String(new FormData(event.currentTarget).get("code") ?? "").replace(/\s/g, "");
    setPending(true);

    const { error } =
      mode === "totp"
        ? await authClient.twoFactor.verifyTotp({ code })
        : await authClient.twoFactor.verifyBackupCode({ code });

    if (error) {
      setPending(false);
      setError(authErrorMessage(error));
      if (error.code === "INVALID_TWO_FACTOR_COOKIE") {
        // O formulário sai de cena e o foco vai para o aviso, que mostra o caminho de volta
        setExpired(true);
        return;
      }
      if (inputRef.current) inputRef.current.value = "";
      inputRef.current?.focus();
      return;
    }
    router.replace(next);
    router.refresh();
  }

  // No modo do app, só números e espaço entram no campo: "12ab" vira "12" enquanto se digita
  function keepDigits(event: React.ChangeEvent<HTMLInputElement>) {
    if (mode !== "totp") return;
    const clean = event.currentTarget.value.replace(/[^\d ]/g, "");
    if (clean !== event.currentTarget.value) event.currentTarget.value = clean;
  }

  function switchMode() {
    setMode((m) => (m === "totp" ? "backup" : "totp"));
    setError(null);
    clear();
    // Depois de trocar, o foco vai para o campo novo
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  if (expired) {
    return (
      <div className="flex flex-col gap-4">
        <FormAlert message={error} focusOnShow />
        <Button asChild size="lg" className="h-11">
          <Link href={signInUrl(next)}>
            <LogIn aria-hidden />
            Entrar de novo
          </Link>
        </Button>
      </div>
    );
  }

  return (
    <>
      <FormAlert message={error} />
      <form onSubmit={handleSubmit} noValidate>
        <FieldGroup>
          <Field data-invalid={errors.code ? true : undefined}>
            <FieldLabel htmlFor="code">{text.label}</FieldLabel>
            <Input
              key={mode}
              ref={inputRef}
              id="code"
              name="code"
              // one-time-code: o celular oferece o código recebido; numeric abre o teclado de números
              autoComplete="one-time-code"
              inputMode={mode === "totp" ? "numeric" : "text"}
              pattern={mode === "totp" ? "[0-9 ]{6,7}" : undefined}
              maxLength={mode === "totp" ? 7 : 21}
              required
              autoFocus
              data-msg-missing={text.missing}
              data-msg-pattern="O código tem 6 números."
              onChange={keepDigits}
              {...fieldProps("code", "code-help")}
              className="tabular h-12 text-center text-lg tracking-[0.3em]"
            />
            <FieldError id={errorId("code")}>{errors.code}</FieldError>
            <FieldDescription id="code-help">{text.help}</FieldDescription>
          </Field>
          <Button type="submit" size="lg" className="h-11" disabled={pending}>
            <ShieldCheck aria-hidden />
            {pending ? "Conferindo…" : "Confirmar"}
          </Button>
          <Button type="button" variant="link" onClick={switchMode}>
            {text.switchTo}
          </Button>
        </FieldGroup>
      </form>
    </>
  );
}
