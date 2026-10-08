"use client";

// Nova recorrência (M07): aluguel, assinatura, salário. Gera um lançamento agendado por mês.
import { ActionForm } from "@/components/feedback/action-form";
import { MoneyInput } from "@/components/money/money-input";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { RECURRENCE_KIND_LABEL } from "@/lib/labels";
import type { CivilDate } from "@fintrack/core";
import { createRecurrenceAction } from "../server/actions";

type Option = { id: string; name: string };

export function RecurrenceForm({
  wallets,
  accounts,
  categories,
  defaults,
}: {
  wallets: Option[];
  accounts: Option[];
  categories: (Option & { kind: "EXPENSE" | "INCOME" })[];
  defaults: { walletId: string | null; accountId: string | null; occurredOn: CivilDate };
}) {
  return (
    <ActionForm
      action={createRecurrenceAction}
      idPrefix="rec-"
      className="flex max-w-md flex-col gap-4"
    >
      {({ pending, field, state }) => {
        const description = field("description");
        const day = field("dayOfMonth", { helpId: "rec-day-help" });
        return (
          <>
            <Field>
              <FieldLabel htmlFor="rec-kind">Tipo</FieldLabel>
              <NativeSelect id="rec-kind" name="kind" defaultValue="FIXED_BILL" className="h-10">
                {(Object.keys(RECURRENCE_KIND_LABEL) as (keyof typeof RECURRENCE_KIND_LABEL)[]).map(
                  (k) => (
                    <option key={k} value={k}>
                      {RECURRENCE_KIND_LABEL[k]}
                    </option>
                  ),
                )}
              </NativeSelect>
            </Field>
            <Field data-invalid={description.error ? true : undefined}>
              <FieldLabel htmlFor="rec-description">Descrição</FieldLabel>
              <Input
                id="rec-description"
                name="description"
                required
                maxLength={200}
                placeholder="Ex.: Aluguel, Streaming, Salário"
                data-msg-missing="Descreva a recorrência, por exemplo: Aluguel."
                className="h-10"
                {...description.props}
              />
              <FieldError id={description.errorId}>{description.error}</FieldError>
            </Field>
            <Field>
              <FieldLabel htmlFor="rec-amount">Valor previsto</FieldLabel>
              {/* key: depois de salvar, o campo volta a zero */}
              <MoneyInput
                key={state.success ?? "novo"}
                id="rec-amount"
                name="amount"
                className="h-10"
              />
            </Field>
            <Field data-invalid={day.error ? true : undefined}>
              <FieldLabel htmlFor="rec-day">Dia do mês</FieldLabel>
              <Input
                id="rec-day"
                name="dayOfMonth"
                type="text"
                inputMode="numeric"
                required
                pattern="([1-9]|[12][0-9]|3[01])"
                defaultValue="10"
                data-msg-pattern="Use um dia de 1 a 31."
                className="h-10 max-w-24"
                {...day.props}
              />
              <FieldDescription id="rec-day-help">
                Dia 31 cai no último dia dos meses mais curtos.
              </FieldDescription>
              <FieldError id={day.errorId}>{day.error}</FieldError>
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="rec-start">Começa em</FieldLabel>
                <Input
                  id="rec-start"
                  name="startsOn"
                  type="date"
                  defaultValue={defaults.occurredOn}
                  className="h-10"
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="rec-end">Termina em (opcional)</FieldLabel>
                <Input id="rec-end" name="endsOn" type="date" className="h-10" />
              </Field>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="rec-account">Conta</FieldLabel>
                <NativeSelect
                  id="rec-account"
                  name="accountId"
                  defaultValue={defaults.accountId ?? ""}
                  className="h-10"
                >
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field>
                <FieldLabel htmlFor="rec-wallet">Carteira</FieldLabel>
                <NativeSelect
                  id="rec-wallet"
                  name="walletId"
                  defaultValue={defaults.walletId ?? ""}
                  className="h-10"
                >
                  {wallets.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
            </div>
            <Field>
              <FieldLabel htmlFor="rec-category">Categoria</FieldLabel>
              <NativeSelect id="rec-category" name="categoryId" defaultValue="" className="h-10">
                <option value="">Sem categoria</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.kind === "EXPENSE" ? "despesa" : "receita"})
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Button type="submit" className="self-start" disabled={pending}>
              {pending ? "Salvando…" : "Criar recorrência"}
            </Button>
          </>
        );
      }}
    </ActionForm>
  );
}
