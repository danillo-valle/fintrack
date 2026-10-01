"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import { undoToast } from "@/components/feedback/undo-toast";
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
import { focusAfterToast } from "@/lib/focus";
import { formatBRL } from "@/lib/money";
import { cn } from "@/lib/utils";

type Kind = "expense" | "income";
type Errors = { amount?: string; description?: string };

function validate(cents: bigint, description: string): Errors {
  const found: Errors = {};
  if (cents <= 0n) found.amount = "Informe um valor maior que zero.";
  if (description.trim() === "") found.description = "Descreva o lançamento, por exemplo: Mercado.";
  return found;
}

// Formulário de demonstração: valida e mostra o aviso, mas ainda não salva (o salvamento chega no M07)
export function NewTransactionForm() {
  const [kind, setKind] = useState<Kind>("expense");
  const [cents, setCents] = useState<bigint>(0n);
  const [description, setDescription] = useState("");
  const [date, setDate] = useState(() => todayISO());
  const [errors, setErrors] = useState<Errors>({});
  const amountRef = useRef<HTMLInputElement>(null);
  const descriptionRef = useRef<HTMLInputElement>(null);

  // O erro de um campo some assim que ele fica válido. Um erro novo só aparece no próximo envio:
  // avisar enquanto a pessoa ainda está digitando atrapalha mais do que ajuda.
  function changeAmount(value: bigint) {
    setCents(value);
    if (value > 0n) setErrors((current) => ({ ...current, amount: undefined }));
  }
  function changeDescription(value: string) {
    setDescription(value);
    if (value.trim() !== "") setErrors((current) => ({ ...current, description: undefined }));
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const found = validate(cents, description);
    setErrors(found);
    // Leva o foco ao primeiro campo com erro: o leitor de tela lê o rótulo e a mensagem
    if (found.amount) return amountRef.current?.focus();
    if (found.description) return descriptionRef.current?.focus();

    const label = kind === "expense" ? "Despesa" : "Receita";
    const saved = { kind, cents, description, date };
    undoToast(`${label} de ${formatBRL(cents)} registrada`, {
      variant: "success",
      description: `${description} · exemplo: o salvamento de verdade chega no M07.`,
      onUndo: () => {
        setKind(saved.kind);
        setCents(saved.cents);
        setDescription(saved.description);
        setDate(saved.date);
        setErrors({});
        toast("Lançamento desfeito");
        // Devolve o foco ao formulário, no primeiro campo a revisar
        focusAfterToast(() => amountRef.current);
      },
    });
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
                  "has-focus-visible:ring-ring flex h-10 cursor-pointer items-center justify-center rounded-md text-sm font-medium has-focus-visible:ring-3",
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
            ref={amountRef}
            id="amount"
            name="amount"
            value={cents}
            onValueChange={changeAmount}
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
            ref={descriptionRef}
            id="description"
            name="description"
            value={description}
            onChange={(event) => changeDescription(event.target.value)}
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
            // O botão do calendário fica dentro do campo e não ativa o focus-visible dele:
            // com focus-within:, o anel do app aparece também quando o foco está nesse botão
            className="focus-within:border-ring focus-within:ring-ring h-10 focus-within:ring-3"
          />
        </Field>

        <Button type="submit" size="lg" className="h-11">
          Salvar lançamento
        </Button>
      </FieldGroup>
    </form>
  );
}
