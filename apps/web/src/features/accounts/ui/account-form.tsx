"use client";

// Nova conta (M07): corrente, poupança, cartão de crédito, vale ou dinheiro. Cartão de crédito
// pede o dia do fechamento e do vencimento da fatura (o banco exige os dois).
import { useState } from "react";
import { ActionForm } from "@/components/feedback/action-form";
import { MoneyInput } from "@/components/money/money-input";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { ACCOUNT_KIND_LABEL } from "@/lib/labels";
import type { AccountKind } from "@fintrack/core";
import { createAccountAction } from "../server/actions";

const KINDS = Object.keys(ACCOUNT_KIND_LABEL) as AccountKind[];

export function AccountForm({ wallets }: { wallets: { id: string; name: string }[] }) {
  const [kind, setKind] = useState<AccountKind>("CHECKING");
  return (
    <ActionForm
      action={createAccountAction}
      idPrefix="conta-"
      className="flex max-w-md flex-col gap-4"
    >
      {({ pending, field, state }) => {
        const name = field("name");
        const closing = field("closingDay");
        const due = field("dueDay");
        return (
          <>
            <Field data-invalid={name.error ? true : undefined}>
              <FieldLabel htmlFor="conta-nome">Nome da conta</FieldLabel>
              <Input
                id="conta-nome"
                name="name"
                required
                maxLength={60}
                placeholder="Ex.: Conta corrente, Cartão Master"
                data-msg-missing="Dê um nome à conta."
                className="h-10"
                {...name.props}
              />
              <FieldError id={name.errorId}>{name.error}</FieldError>
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="conta-tipo">Tipo</FieldLabel>
                <NativeSelect
                  id="conta-tipo"
                  name="kind"
                  value={kind}
                  onChange={(e) => setKind(e.target.value as AccountKind)}
                  className="h-10"
                >
                  {KINDS.map((k) => (
                    <option key={k} value={k}>
                      {ACCOUNT_KIND_LABEL[k]}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field>
                <FieldLabel htmlFor="conta-carteira">Carteira que gere</FieldLabel>
                <NativeSelect id="conta-carteira" name="walletId" className="h-10">
                  {wallets.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
            </div>
            {kind === "CREDIT_CARD" ? (
              <div className="grid gap-4 sm:grid-cols-2">
                <Field data-invalid={closing.error ? true : undefined}>
                  <FieldLabel htmlFor="conta-fecha">Fecha no dia</FieldLabel>
                  <Input
                    id="conta-fecha"
                    name="closingDay"
                    inputMode="numeric"
                    required
                    pattern="([1-9]|[12][0-9]|3[01])"
                    data-msg-missing="Informe o dia do fechamento."
                    data-msg-pattern="Use um dia de 1 a 31."
                    className="h-10"
                    {...closing.props}
                  />
                  <FieldError id={closing.errorId}>{closing.error}</FieldError>
                </Field>
                <Field data-invalid={due.error ? true : undefined}>
                  <FieldLabel htmlFor="conta-vence">Vence no dia</FieldLabel>
                  <Input
                    id="conta-vence"
                    name="dueDay"
                    inputMode="numeric"
                    required
                    pattern="([1-9]|[12][0-9]|3[01])"
                    data-msg-missing="Informe o dia do vencimento."
                    data-msg-pattern="Use um dia de 1 a 31."
                    className="h-10"
                    {...due.props}
                  />
                  <FieldError id={due.errorId}>{due.error}</FieldError>
                </Field>
              </div>
            ) : (
              <Field>
                <FieldLabel htmlFor="conta-saldo">Saldo inicial</FieldLabel>
                <MoneyInput
                  key={state.success ?? "nova"}
                  id="conta-saldo"
                  name="initialBalance"
                  aria-describedby="conta-saldo-help"
                  className="h-10"
                />
                <FieldDescription id="conta-saldo-help">
                  O saldo no dia em que você começa a acompanhar.
                </FieldDescription>
              </Field>
            )}
            <Field>
              <FieldLabel htmlFor="conta-banco">Banco ou emissor (opcional)</FieldLabel>
              <Input id="conta-banco" name="institution" maxLength={60} className="h-10" />
            </Field>
            <Button type="submit" className="self-start" disabled={pending}>
              {pending ? "Criando…" : "Criar conta"}
            </Button>
          </>
        );
      }}
    </ActionForm>
  );
}
