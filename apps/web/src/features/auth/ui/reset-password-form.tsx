"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { authClient } from "@/lib/auth-client";
import { authErrorMessage } from "@/lib/auth/messages";
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "@/lib/auth/password-policy";
import { FormAlert } from "./form-alert";
import { PasswordInput } from "./password-input";

// Troca de senha pelo link do e-mail. O token vem na URL (?token=...) e vale uma vez.
// Depois da troca, todas as sessões abertas caem (revokeSessionsOnPasswordReset no auth.ts).
export function ResetPasswordForm({ token }: { token: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const passwordRef = useRef<HTMLInputElement>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    const { error } = await authClient.resetPassword({
      newPassword: String(new FormData(event.currentTarget).get("password") ?? ""),
      token,
    });
    if (error) {
      setPending(false);
      setError(authErrorMessage(error));
      passwordRef.current?.focus();
      return;
    }
    router.replace("/entrar?aviso=senha-trocada");
  }

  return (
    <>
      <FormAlert message={error} />
      <form onSubmit={handleSubmit}>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="password">Nova senha</FieldLabel>
            <PasswordInput
              ref={passwordRef}
              id="password"
              name="password"
              autoComplete="new-password"
              minLength={PASSWORD_MIN_LENGTH}
              maxLength={PASSWORD_MAX_LENGTH}
              required
              aria-describedby="password-help"
            />
            <FieldDescription id="password-help">
              Pelo menos {PASSWORD_MIN_LENGTH} caracteres. Senhas vazadas são recusadas.
            </FieldDescription>
          </Field>
          <Button type="submit" size="lg" className="h-11" disabled={pending}>
            <KeyRound aria-hidden />
            {pending ? "Salvando…" : "Salvar a nova senha"}
          </Button>
        </FieldGroup>
      </form>
    </>
  );
}
