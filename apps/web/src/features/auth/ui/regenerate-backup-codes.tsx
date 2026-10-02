"use client";

import { useState } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { authClient } from "@/lib/auth-client";
import { authErrorMessage } from "@/lib/auth/messages";
import { useFieldErrors } from "@/lib/use-field-errors";
import { BackupCodes } from "./backup-codes";
import { FormAlert } from "./form-alert";
import { PasswordInput } from "./password-input";

// Gera 10 códigos de backup novos (os antigos deixam de valer). Pede a senha:
// o próprio Better Auth exige, porque é uma ação sensível.
export function RegenerateBackupCodes() {
  // Prefixo "backup-": a tela Segurança tem outro formulário (trocar a senha) com avisos próprios
  const { errors, validate, fieldProps, errorId, alertId, markAlert } = useFieldErrors("backup-");
  const [codes, setCodes] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // Campos vazios ou fora do formato: aviso embaixo do campo, foco no primeiro
    if (!validate(event.currentTarget)) return;
    const form = event.currentTarget;
    setPending(true);
    setError(null);
    const { data, error } = await authClient.twoFactor.generateBackupCodes({
      password: String(new FormData(event.currentTarget).get("password") ?? ""),
    });
    setPending(false);
    if (error || !data) {
      setError(authErrorMessage(error));
      // Senha errada: foco e aviso ligados ao campo da senha
      markAlert("password");
      form.querySelector<HTMLInputElement>('input[name="password"]')?.focus();
      return;
    }
    setCodes(data.backupCodes);
  }

  if (codes) {
    return (
      <div className="flex flex-col gap-3">
        <FormAlert
          variant="success"
          focusOnShow
          message="Códigos novos gerados. Os antigos não valem mais. Guarde estes agora: eles não aparecem de novo."
        />
        <BackupCodes codes={codes} />
      </div>
    );
  }

  return (
    <>
      <FormAlert id={alertId} message={error} />
      <form onSubmit={handleSubmit} noValidate>
        <FieldGroup>
          <Field data-invalid={errors.password ? true : undefined}>
            <FieldLabel htmlFor="backup-password">Senha</FieldLabel>
            <PasswordInput
              id="backup-password"
              name="password"
              autoComplete="current-password"
              required
              data-msg-missing="Digite a sua senha."
              {...fieldProps("password", { helpId: "backup-help" })}
            />
            <FieldError id={errorId("password")}>{errors.password}</FieldError>
            <FieldDescription id="backup-help">
              Use quando tiver gastado vários códigos ou quando achar que alguém os viu.
            </FieldDescription>
          </Field>
          <div>
            <Button type="submit" variant="outline" disabled={pending}>
              <RefreshCw aria-hidden />
              {pending ? "Gerando…" : "Gerar códigos novos"}
            </Button>
          </div>
        </FieldGroup>
      </form>
    </>
  );
}
