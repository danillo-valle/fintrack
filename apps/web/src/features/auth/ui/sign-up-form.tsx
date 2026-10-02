"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { authClient } from "@/lib/auth-client";
import { authErrorMessage } from "@/lib/auth/messages";
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "@/lib/auth/password-policy";
import { useFieldErrors } from "@/lib/use-field-errors";
import { FormAlert } from "./form-alert";
import { PasswordInput } from "./password-input";

// Cadastro. Só os e-mails da lista ALLOWED_EMAILS passam (hook no auth.ts);
// para os outros, o servidor recusa e esta tela mostra o motivo.
export function SignUpForm() {
  const { errors, validate, fieldProps, errorId } = useFieldErrors();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // Campos vazios ou fora do formato: aviso embaixo do campo, foco no primeiro
    if (!validate(event.currentTarget)) return;
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") ?? "").trim();
    setPending(true);
    setError(null);

    const { error } = await authClient.signUp.email({
      name: String(form.get("name") ?? "").trim(),
      email,
      password: String(form.get("password") ?? ""),
      // O link do e-mail de confirmação volta para cá depois de confirmar
      callbackURL: "/configurar-2fa",
    });

    if (error) {
      setPending(false);
      setError(authErrorMessage(error));
      // Foco no campo que provavelmente precisa mudar
      const passwordProblem = ["PASSWORD_TOO_SHORT", "PASSWORD_TOO_LONG", "PASSWORD_COMPROMISED"];
      if (error.code && passwordProblem.includes(error.code)) passwordRef.current?.focus();
      else emailRef.current?.focus();
      return;
    }
    router.push(`/verifique-seu-email?email=${encodeURIComponent(email)}`);
  }

  return (
    <>
      <FormAlert message={error} />
      <form onSubmit={handleSubmit} noValidate>
        <FieldGroup>
          <Field data-invalid={errors.name ? true : undefined}>
            <FieldLabel htmlFor="name">Nome</FieldLabel>
            <Input
              id="name"
              name="name"
              autoComplete="name"
              required
              className="h-10"
              data-msg-missing="Digite o seu nome."
              {...fieldProps("name")}
            />
            <FieldError id={errorId("name")}>{errors.name}</FieldError>
          </Field>
          <Field data-invalid={errors.email ? true : undefined}>
            <FieldLabel htmlFor="email">E-mail</FieldLabel>
            <Input
              ref={emailRef}
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              required
              className="h-10"
              data-msg-missing="Digite o seu e-mail."
              {...fieldProps("email")}
            />
            <FieldError id={errorId("email")}>{errors.email}</FieldError>
          </Field>
          <Field data-invalid={errors.password ? true : undefined}>
            <FieldLabel htmlFor="password">Senha</FieldLabel>
            <PasswordInput
              ref={passwordRef}
              id="password"
              name="password"
              autoComplete="new-password"
              minLength={PASSWORD_MIN_LENGTH}
              maxLength={PASSWORD_MAX_LENGTH}
              required
              data-msg-missing="Crie uma senha."
              {...fieldProps("password", "password-help")}
            />
            <FieldError id={errorId("password")}>{errors.password}</FieldError>
            <FieldDescription id="password-help">
              Pelo menos {PASSWORD_MIN_LENGTH} caracteres. Uma frase que só você conhece é mais
              forte e mais fácil de lembrar que uma palavra com símbolos. Senhas vazadas são
              recusadas.
            </FieldDescription>
          </Field>
          <Button type="submit" size="lg" className="h-11" disabled={pending}>
            <UserPlus aria-hidden />
            {pending ? "Criando…" : "Criar conta"}
          </Button>
        </FieldGroup>
      </form>
    </>
  );
}
