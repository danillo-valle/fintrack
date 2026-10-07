"use client";

import { House } from "lucide-react";
import { ActionForm } from "@/components/feedback/action-form";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { createHouseholdAction } from "../server/actions";

// Primeiro passo do M06: criar o lar. Quem cria vira dona e ganha a carteira pessoal.
export function CreateHouseholdForm() {
  return (
    <ActionForm
      action={createHouseholdAction}
      className="flex max-w-md flex-col gap-4"
      idPrefix="lar-"
    >
      {({ pending, field }) => {
        const name = field("name", { helpId: "household-name-help" });
        return (
          <>
            <Field data-invalid={name.error ? true : undefined}>
              <FieldLabel htmlFor="household-name">Nome do lar</FieldLabel>
              <Input
                id="household-name"
                name="name"
                required
                maxLength={60}
                autoComplete="off"
                placeholder="Ex.: Casa Exemplo"
                data-msg-missing="Dê um nome ao lar."
                {...name.props}
              />
              <FieldDescription id="household-name-help">
                Você será dono do lar e poderá convidar outras pessoas.
              </FieldDescription>
              <FieldError id={name.errorId}>{name.error}</FieldError>
            </Field>
            <Button type="submit" size="lg" className="h-11 self-start" disabled={pending}>
              <House aria-hidden />
              {pending ? "Criando…" : "Criar meu lar"}
            </Button>
          </>
        );
      }}
    </ActionForm>
  );
}
