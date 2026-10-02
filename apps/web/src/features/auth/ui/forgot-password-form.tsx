"use client";

import { useState } from "react";
import { Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { authClient } from "@/lib/auth-client";
import { authErrorMessage } from "@/lib/auth/messages";
import { FormAlert } from "./form-alert";

// "Esqueci a senha": pede o link de troca por e-mail.
// A resposta é a mesma exista ou não a conta, para a tela não revelar quem tem cadastro.
export function ForgotPasswordForm() {
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    const { error } = await authClient.requestPasswordReset({
      email: String(new FormData(event.currentTarget).get("email") ?? "").trim(),
      redirectTo: "/redefinir-senha",
    });
    setPending(false);
    // Só o limite de tentativas vira erro na tela; o resto recebe a mesma mensagem de sucesso
    if (error?.status === 429) {
      setError(authErrorMessage(error));
      return;
    }
    setSent(true);
  }

  if (sent) {
    return (
      <FormAlert
        variant="success"
        focusOnShow
        message="Se houver uma conta com este e-mail, o link para trocar a senha chega em instantes. Ele vale por 1 hora."
      />
    );
  }

  return (
    <>
      <FormAlert message={error} />
      <form onSubmit={handleSubmit}>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="email">E-mail da conta</FieldLabel>
            <Input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              required
              className="h-10"
            />
          </Field>
          <Button type="submit" size="lg" className="h-11" disabled={pending}>
            <Mail aria-hidden />
            {pending ? "Enviando…" : "Enviar o link"}
          </Button>
        </FieldGroup>
      </form>
    </>
  );
}
