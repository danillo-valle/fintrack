"use client";

import { useState } from "react";
import { isCheckable, messageFor } from "./form-errors";

export type FieldErrors = Record<string, string>;

type FieldOptions = {
  /** id da ajuda do campo (FieldDescription), lida depois do erro */
  helpId?: string;
  /** Tira o erro a cada tecla, mesmo antes de o campo ficar válido (campos curtos, como o código) */
  clearOnInput?: boolean;
  /** Liga o aviso do formulário a este campo vindo de fora (ex.: erro devolvido por Server Action) */
  linkAlert?: boolean;
};

/**
 * Erros por campo de um formulário com noValidate.
 *
 *   const { errors, validate, fieldProps, errorId, alertId, markAlert } = useFieldErrors();
 *   if (!validate(event.currentTarget)) return;             // no começo do onSubmit
 *   <FormAlert id={alertId} message={error} />               // aviso do formulário inteiro
 *   <Input {...fieldProps("email", { helpId: "email-help" })} />
 *   <FieldError id={errorId("email")}>{errors.email}</FieldError>
 *   markAlert("password")                                    // erro do servidor: liga o aviso ao campo
 *
 * Regras (as mesmas do M02): o foco vai para o primeiro campo com erro; o erro de um campo some
 * assim que ele fica válido; um erro novo só aparece no próximo envio.
 *
 * Erros que só o servidor conhece (senha errada, senha vazada, código incorreto) aparecem no
 * aviso do formulário (FormAlert). markAlert(campo) liga esse aviso ao campo que recebe o foco:
 * aria-invalid e aria-describedby apontando para o aviso. Assim, quem chega ao campo pelo leitor
 * de tela ouve o motivo junto com o rótulo. A marca sai quando a pessoa volta a digitar.
 */
export function useFieldErrors(prefix = "") {
  const [errors, setErrors] = useState<FieldErrors>({});
  const [alertFor, setAlertFor] = useState<string | null>(null);
  const errorId = (name: string) => `${prefix}${name}-error`;
  const alertId = `${prefix}form-alert`;

  function validate(form: HTMLFormElement): boolean {
    const found: FieldErrors = {};
    let first: HTMLInputElement | null = null;
    for (const el of Array.from(form.elements)) {
      if (!isCheckable(el)) continue;
      const message = messageFor(el);
      if (message) {
        found[el.name] = message;
        first ??= el;
      }
    }
    setErrors(found);
    setAlertFor(null); // envio novo: o aviso antigo do servidor não vale mais
    first?.focus();
    return first === null;
  }

  function removeError(name: string) {
    setErrors((current) => {
      if (!(name in current)) return current;
      const rest = { ...current };
      delete rest[name];
      return rest;
    });
  }

  function fieldProps(name: string, options: FieldOptions = {}) {
    const error = errors[name];
    const linkedToAlert = alertFor === name || options.linkAlert === true;
    const describedBy = [
      error ? errorId(name) : null,
      linkedToAlert ? alertId : null,
      options.helpId,
    ]
      .filter(Boolean)
      .join(" ");
    return {
      "aria-invalid": error || linkedToAlert ? true : undefined,
      "aria-describedby": describedBy || undefined,
      onInput: (event: React.FormEvent<HTMLInputElement>) => {
        if (linkedToAlert) setAlertFor(null);
        if (error && (options.clearOnInput || !messageFor(event.currentTarget))) removeError(name);
      },
    } as const;
  }

  return {
    errors,
    validate,
    fieldProps,
    errorId,
    alertId,
    markAlert: setAlertFor,
    clear: () => {
      setErrors({});
      setAlertFor(null);
    },
  };
}
