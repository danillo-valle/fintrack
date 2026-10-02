"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { authClient } from "@/lib/auth-client";
import { authErrorMessage } from "@/lib/auth/messages";
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "@/lib/auth/password-policy";
import { useFieldErrors } from "@/lib/use-field-errors";
import { FormAlert } from "./form-alert";
import { PasswordInput } from "./password-input";

// Trocar a senha para quem está logado e lembra a senha atual (tela Segurança).
// Quem esqueceu usa o outro caminho: /esqueci-a-senha, com link por e-mail.
//
// O que protege esta troca, do lado do servidor (auth.ts):
// - o Better Auth confere a senha atual antes de gravar a nova;
// - no máximo 5 tentativas por minuto (rateLimit "/change-password");
// - a senha nova passa pelas mesmas regras do cadastro (8 a 128 caracteres, senhas vazadas não);
// - um e-mail avisa a troca, para a pessoa saber se não foi ela.
// Sem campo "repita a senha": o botão Mostrar do PasswordInput evita o erro de digitação.
export function ChangePasswordForm() {
  const { errors, validate, fieldProps, errorId } = useFieldErrors();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const currentRef = useRef<HTMLInputElement>(null);
  const newRef = useRef<HTMLInputElement>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const currentPassword = String(data.get("currentPassword") ?? "");
    const newPassword = String(data.get("newPassword") ?? "");
    // Checkbox marcado envia "on"; desmarcado não envia nada
    const revokeOtherSessions = data.get("revokeOtherSessions") === "on";

    setError(null);
    setSuccess(null);
    // Campos vazios ou senha nova curta: aviso embaixo do campo, foco no primeiro
    if (!validate(form)) return;
    // Trocar pela mesma senha não muda nada e passaria a falsa ideia de que a conta ficou segura
    if (currentPassword === newPassword) {
      setError("A senha nova precisa ser diferente da atual.");
      newRef.current?.focus();
      return;
    }

    setPending(true);
    const { error } = await authClient.changePassword({
      currentPassword,
      newPassword,
      revokeOtherSessions,
    });
    setPending(false);

    if (error) {
      // Senha atual errada: o foco volta para ela; outros erros (senha nova fraca) vão para a nova
      if (error.code === "INVALID_PASSWORD") {
        setError("A senha atual não confere.");
        currentRef.current?.focus();
      } else {
        setError(authErrorMessage(error));
        newRef.current?.focus();
      }
      return;
    }

    // Limpa os campos: senha não fica parada na tela depois de usada
    form.reset();
    setSuccess(
      revokeOtherSessions
        ? "Senha trocada. As sessões nos outros aparelhos foram encerradas."
        : "Senha trocada.",
    );
    // Recarrega os dados do servidor: a lista de sessões abaixo muda quando as outras caem
    router.refresh();
  }

  return (
    <>
      <FormAlert message={error} />
      <FormAlert message={success} variant="success" focusOnShow />
      <form onSubmit={handleSubmit} noValidate>
        <FieldGroup>
          <Field data-invalid={errors.currentPassword ? true : undefined}>
            <FieldLabel htmlFor="current-password">Senha atual</FieldLabel>
            <PasswordInput
              ref={currentRef}
              id="current-password"
              name="currentPassword"
              autoComplete="current-password"
              maxLength={PASSWORD_MAX_LENGTH}
              required
              data-msg-missing="Digite a senha atual."
              {...fieldProps("currentPassword")}
            />
            <FieldError id={errorId("currentPassword")}>{errors.currentPassword}</FieldError>
          </Field>
          <Field data-invalid={errors.newPassword ? true : undefined}>
            <FieldLabel htmlFor="new-password">Senha nova</FieldLabel>
            <PasswordInput
              ref={newRef}
              id="new-password"
              name="newPassword"
              autoComplete="new-password"
              minLength={PASSWORD_MIN_LENGTH}
              maxLength={PASSWORD_MAX_LENGTH}
              required
              data-msg-missing="Digite a senha nova."
              {...fieldProps("newPassword", "new-password-help")}
            />
            <FieldError id={errorId("newPassword")}>{errors.newPassword}</FieldError>
            <FieldDescription id="new-password-help">
              Pelo menos {PASSWORD_MIN_LENGTH} caracteres. Uma frase é mais fácil de lembrar e mais
              difícil de adivinhar. Senhas vazadas são recusadas.
            </FieldDescription>
          </Field>
          {/* Checkbox nativo, como no passo 3 do 2FA: o rótulo envolve a caixa e o clique no texto marca */}
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              name="revokeOtherSessions"
              defaultChecked
              className="accent-primary mt-0.5 size-4"
            />
            Encerrar a sessão nos outros aparelhos
          </label>
          <Button type="submit" size="lg" className="h-11 self-start" disabled={pending}>
            <KeyRound aria-hidden />
            {pending ? "Trocando…" : "Trocar a senha"}
          </Button>
        </FieldGroup>
      </form>
    </>
  );
}
