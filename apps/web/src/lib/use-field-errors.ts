"use client";

import { useState } from "react";
import { isCheckable, messageFor } from "./form-errors";

export type FieldErrors = Record<string, string>;

/**
 * Erros por campo de um formulário com noValidate.
 *
 *   const { errors, validate, fieldProps } = useFieldErrors();
 *   if (!validate(event.currentTarget)) return;            // no começo do onSubmit
 *   <Input {...fieldProps("email", "email-help")} />        // aria-invalid e aria-describedby
 *   <FieldError id={errorId("email")}>{errors.email}</FieldError>
 *
 * Regras (as mesmas do M02): o foco vai para o primeiro campo com erro; o erro de um campo some
 * assim que ele fica válido; um erro novo só aparece no próximo envio.
 */
export function useFieldErrors(prefix = "") {
  const [errors, setErrors] = useState<FieldErrors>({});
  const errorId = (name: string) => `${prefix}${name}-error`;

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
    first?.focus();
    return first === null;
  }

  function fieldProps(name: string, helpId?: string) {
    const error = errors[name];
    const describedBy = [error ? errorId(name) : null, helpId].filter(Boolean).join(" ");
    return {
      "aria-invalid": error ? true : undefined,
      "aria-describedby": describedBy || undefined,
      onInput: (event: React.FormEvent<HTMLInputElement>) => {
        if (error && !messageFor(event.currentTarget)) {
          setErrors((current) => {
            const rest = { ...current };
            delete rest[name];
            return rest;
          });
        }
      },
    } as const;
  }

  return { errors, validate, fieldProps, errorId, clear: () => setErrors({}) };
}
