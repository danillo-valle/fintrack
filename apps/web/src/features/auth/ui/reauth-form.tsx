"use client";

import { useActionState, useState } from "react";
import { Fingerprint, KeyRound, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, FieldGroup, FieldLabel, FieldSeparator } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { authClient } from "@/lib/auth-client";
import { isCancelled } from "@/lib/auth/messages";
import { finishPasskeyReauth, reauthenticate, type ReauthState } from "../server/actions";
import { FormAlert } from "./form-alert";
import { PasswordInput } from "./password-input";

type Props = { next: string; sessionId: string };

const initial: ReauthState = { error: null };

// Confirmação de identidade antes de uma ação sensível: senha, código do app ou passkey.
export function ReauthForm({ next, sessionId }: Props) {
  const [method, setMethod] = useState<"password" | "totp">("password");
  const [state, formAction, pending] = useActionState(reauthenticate, initial);
  const [passkeyError, setPasskeyError] = useState<string | null>(null);

  async function confirmWithPasskey() {
    setPasskeyError(null);
    const result = await authClient.signIn.passkey();
    if (result?.error) {
      if (!isCancelled(result.error)) {
        setPasskeyError("Não foi possível confirmar com a passkey. Use a senha ou o código.");
      }
      return;
    }
    // A passkey criou uma sessão nova; a anterior, deste aparelho, é apagada
    await finishPasskeyReauth(sessionId, next);
  }

  return (
    <>
      <FormAlert message={state.error ?? passkeyError} />
      <form action={formAction}>
        <input type="hidden" name="method" value={method} />
        <input type="hidden" name="next" value={next} />
        <FieldGroup>
          {method === "password" ? (
            <Field>
              <FieldLabel htmlFor="password">Senha</FieldLabel>
              <PasswordInput
                id="password"
                name="password"
                autoComplete="current-password"
                required
                autoFocus
              />
            </Field>
          ) : (
            <Field>
              <FieldLabel htmlFor="code">Código do app autenticador</FieldLabel>
              <Input
                id="code"
                name="code"
                autoComplete="one-time-code"
                inputMode="numeric"
                pattern="[0-9 ]{6,7}"
                maxLength={7}
                required
                autoFocus
                className="tabular h-12 text-center text-lg tracking-[0.3em]"
              />
            </Field>
          )}
          <Button type="submit" size="lg" className="h-11" disabled={pending}>
            <ShieldCheck aria-hidden />
            {pending ? "Conferindo…" : "Confirmar"}
          </Button>
          <Button
            type="button"
            variant="link"
            onClick={() => setMethod((m) => (m === "password" ? "totp" : "password"))}
          >
            <KeyRound aria-hidden />
            {method === "password" ? "Usar o código do app" : "Usar a senha"}
          </Button>
          <FieldSeparator>ou</FieldSeparator>
          <Button
            type="button"
            variant="outline"
            size="lg"
            className="h-11"
            onClick={confirmWithPasskey}
          >
            <Fingerprint aria-hidden />
            Confirmar com passkey
          </Button>
        </FieldGroup>
      </form>
    </>
  );
}
