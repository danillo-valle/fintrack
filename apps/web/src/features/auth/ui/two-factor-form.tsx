"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { authClient } from "@/lib/auth-client";
import { authErrorMessage } from "@/lib/auth/messages";
import { FormAlert } from "./form-alert";

type Mode = "totp" | "backup";

// Segundo passo do login: o código de 6 dígitos do app autenticador (ou um código de backup).
// A sessão só é criada quando este código confere.
export function TwoFactorForm({ next }: { next: string }) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("totp");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // Espaços são aceitos ("123 456") e removidos aqui. O hífen fica: ele faz parte do código de backup
    const code = String(new FormData(event.currentTarget).get("code") ?? "").replace(/\s/g, "");
    setPending(true);
    setError(null);

    const { error } =
      mode === "totp"
        ? await authClient.twoFactor.verifyTotp({ code })
        : await authClient.twoFactor.verifyBackupCode({ code });

    if (error) {
      setPending(false);
      setError(authErrorMessage(error));
      if (inputRef.current) inputRef.current.value = "";
      inputRef.current?.focus();
      return;
    }
    router.replace(next);
    router.refresh();
  }

  function switchMode() {
    setMode((m) => (m === "totp" ? "backup" : "totp"));
    setError(null);
    // Depois de trocar, o foco vai para o campo novo
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  return (
    <>
      <FormAlert message={error} />
      <form onSubmit={handleSubmit}>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="code">
              {mode === "totp" ? "Código do app autenticador" : "Código de backup"}
            </FieldLabel>
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
              aria-describedby="code-help"
              className="tabular h-12 text-center text-lg tracking-[0.3em]"
            />
            <FieldDescription id="code-help">
              {mode === "totp"
                ? "Abra o app autenticador e digite os 6 números do FinTrack."
                : "Use um dos códigos que você guardou ao ligar o 2FA. Cada um vale uma vez."}
            </FieldDescription>
          </Field>
          <Button type="submit" size="lg" className="h-11" disabled={pending}>
            <ShieldCheck aria-hidden />
            {pending ? "Conferindo…" : "Confirmar"}
          </Button>
          <Button type="button" variant="link" onClick={switchMode}>
            {mode === "totp" ? "Usar um código de backup" : "Usar o app autenticador"}
          </Button>
        </FieldGroup>
      </form>
    </>
  );
}
