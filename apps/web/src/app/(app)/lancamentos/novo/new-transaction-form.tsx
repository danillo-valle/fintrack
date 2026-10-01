"use client";

import { useState } from "react";
import { flushSync } from "react-dom";
import { toast } from "sonner";
import { undoToastOptions } from "@/components/feedback/undo-toast";
import { MoneyInput } from "@/components/money/money-input";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { todayISO } from "@/lib/dates";
import { formatBRL } from "@/lib/money";
import { cn } from "@/lib/utils";

type Kind = "expense" | "income";

// Formulário de demonstração: valida e mostra o aviso, mas ainda não salva (o salvamento chega no M07)
export function NewTransactionForm() {
  const [kind, setKind] = useState<Kind>("expense");
  const [cents, setCents] = useState<bigint>(0n);
  const [description, setDescription] = useState("");
  const [date, setDate] = useState(() => todayISO());
  const [errors, setErrors] = useState<{ amount?: string; description?: string }>({});

  // O erro some assim que o campo fica válido; voltar a ficar inválido só é apontado no próximo envio
  function clearError(field: keyof typeof errors) {
    setErrors((current) => {
      if (!current[field]) return current;
      const next = { ...current };
      delete next[field];
      return next;
    });
  }

  function handleAmountChange(next: bigint) {
    setCents(next);
    if (next > 0n) clearError("amount");
  }

  function handleDescriptionChange(next: string) {
    setDescription(next);
    if (next.trim() !== "") clearError("description");
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const found: typeof errors = {};
    if (cents <= 0n) found.amount = "Informe um valor maior que zero.";
    if (description.trim() === "")
      found.description = "Descreva o lançamento, por exemplo: Mercado.";
    // flushSync: o campo já precisa estar com aria-invalid e a mensagem de erro quando receber o foco
    flushSync(() => setErrors(found));
    if (found.amount || found.description) {
      document.getElementById(found.amount ? "amount" : "description")?.focus();
      return;
    }

    const label = kind === "expense" ? "Despesa" : "Receita";
    const saved = { kind, cents, description, date };
    toast.success(
      `${label} de ${formatBRL(cents)} registrada`,
      undoToastOptions({
        description: `${description} · exemplo: o salvamento de verdade chega no M07`,
        onUndo: () => {
          flushSync(() => {
            setKind(saved.kind);
            setCents(saved.cents);
            setDescription(saved.description);
            setDate(saved.date);
          });
          // Volta para o primeiro campo restaurado, em vez de deixar o foco no body
          document.getElementById("amount")?.focus();
          toast("Lançamento desfeito");
        },
      }),
    );
    setCents(0n);
    setDescription("");
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="max-w-md">
      <FieldGroup>
        <FieldSet>
          <FieldLegend variant="label">Tipo</FieldLegend>
          {/* Rádios nativos: teclado (setas) e leitor de tela funcionam sem código extra */}
          <div className="bg-muted grid grid-cols-2 gap-1 rounded-lg p-1">
            {(["expense", "income"] as const).map((option) => (
              <label
                key={option}
                className={cn(
                  "has-focus-visible:ring-ring/50 flex h-10 cursor-pointer items-center justify-center rounded-md text-sm font-medium has-focus-visible:ring-3",
                  kind === option && "bg-background shadow-sm",
                  kind === option && option === "expense" && "text-expense",
                  kind === option && option === "income" && "text-income",
                )}
              >
                <input
                  type="radio"
                  name="kind"
                  value={option}
                  checked={kind === option}
                  onChange={() => setKind(option)}
                  className="sr-only"
                />
                {option === "expense" ? "Despesa" : "Receita"}
              </label>
            ))}
          </div>
        </FieldSet>

        <Field data-invalid={errors.amount ? true : undefined}>
          <FieldLabel htmlFor="amount">Valor</FieldLabel>
          <MoneyInput
            id="amount"
            name="amount"
            value={cents}
            onValueChange={handleAmountChange}
            aria-invalid={errors.amount ? true : undefined}
            aria-describedby={errors.amount ? "amount-error" : "amount-help"}
            className="h-12 text-lg"
          />
          {errors.amount ? (
            <FieldError id="amount-error">{errors.amount}</FieldError>
          ) : (
            <FieldDescription id="amount-help">
              Digite só os números. 1234 vira R$ 12,34.
            </FieldDescription>
          )}
        </Field>

        <Field data-invalid={errors.description ? true : undefined}>
          <FieldLabel htmlFor="description">Descrição</FieldLabel>
          <Input
            id="description"
            name="description"
            value={description}
            onChange={(event) => handleDescriptionChange(event.target.value)}
            autoComplete="off"
            aria-invalid={errors.description ? true : undefined}
            aria-describedby={errors.description ? "description-error" : undefined}
            className="h-10"
          />
          {errors.description ? (
            <FieldError id="description-error">{errors.description}</FieldError>
          ) : null}
        </Field>

        <Field>
          <FieldLabel htmlFor="date">Data</FieldLabel>
          <Input
            id="date"
            name="date"
            type="date"
            value={date}
            onChange={(event) => setDate(event.target.value)}
            className="h-10"
          />
        </Field>

        <Button type="submit" size="lg" className="h-11">
          Salvar lançamento
        </Button>
      </FieldGroup>
    </form>
  );
}
