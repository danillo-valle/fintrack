"use client";

import { useEffect, useRef } from "react";
import { CircleAlert, CircleCheck } from "lucide-react";
import { cn } from "@/lib/utils";

type Props = {
  message: string | null;
  /** Para um campo apontar para este aviso com aria-describedby (useFieldErrors.alertId) */
  id?: string;
  variant?: "error" | "success";
  /** Leva o foco ao aviso quando ele aparece (útil quando o formulário inteiro falhou) */
  focusOnShow?: boolean;
};

// Mensagem do formulário inteiro (ex.: "E-mail ou senha incorretos").
// role="alert" faz o leitor de tela anunciar na hora; o ícone e o texto não dependem da cor.
export function FormAlert({ message, variant = "error", focusOnShow = false, id }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (message && focusOnShow) ref.current?.focus();
  }, [message, focusOnShow]);

  if (!message) return null;
  const Icon = variant === "error" ? CircleAlert : CircleCheck;

  return (
    <div
      ref={ref}
      id={id}
      tabIndex={-1}
      role={variant === "error" ? "alert" : "status"}
      data-slot="form-alert"
      className={cn(
        "focus-visible:ring-ring mb-4 flex gap-2 rounded-lg border p-3 text-sm outline-none focus-visible:ring-3",
        variant === "error" && "border-destructive/40 text-destructive",
        variant === "success" && "border-income/40 text-income",
      )}
    >
      <Icon aria-hidden className="mt-0.5 size-4 shrink-0" />
      <span>{message}</span>
    </div>
  );
}
