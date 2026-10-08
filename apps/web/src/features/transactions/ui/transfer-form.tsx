"use client";

// Transferência entre contas (M07), inclusive o pagamento da fatura do cartão: dois lados com
// o mesmo valor, que não contam como gasto nem como receita.
import { useActionState, useRef, useState } from "react";
import { MoneyInput } from "@/components/money/money-input";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { FormAlert } from "@/features/auth/ui/form-alert";
import { INITIAL_ACTION_STATE } from "@/lib/action-state";
import { ACCOUNT_KIND_LABEL, METHOD_LABEL } from "@/lib/labels";
import type { AccountKind, CivilDate } from "@fintrack/core";
import { createTransferAction, type EntryState } from "../server/actions";

type Account = { id: string; name: string; kind: AccountKind };
type Errors = { amount?: string; to?: string };

const INITIAL: EntryState = { ...INITIAL_ACTION_STATE, created: null, version: 0 };

export function TransferForm({ accounts, today }: { accounts: Account[]; today: CivilDate }) {
  const [state, action, pending] = useActionState(createTransferAction, INITIAL);
  const [cents, setCents] = useState(0n);
  const [from, setFrom] = useState(accounts[0]?.id ?? "");
  const [to, setTo] = useState(accounts[1]?.id ?? "");
  const [errors, setErrors] = useState<Errors>({});
  const amountRef = useRef<HTMLInputElement>(null);
  const toRef = useRef<HTMLSelectElement>(null);
  const [version, setVersion] = useState(0);

  // Depois de salvar, o valor zera (o resto fica: é comum repetir as mesmas contas)
  if (state.version !== version) {
    setVersion(state.version);
    setCents(0n);
  }

  return (
    <form
      action={action}
      noValidate
      className="max-w-md"
      onSubmit={(event) => {
        const found: Errors = {};
        if (cents <= 0n) found.amount = "Informe um valor maior que zero.";
        if (from === to) found.to = "Escolha duas contas diferentes.";
        setErrors(found);
        if (found.amount) amountRef.current?.focus();
        else if (found.to) toRef.current?.focus();
        if (Object.keys(found).length > 0) event.preventDefault();
      }}
    >
      <FormAlert message={state.error} />
      <FormAlert message={state.error ? null : state.success} variant="success" />
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="fromAccountId">De (sai daqui)</FieldLabel>
          <NativeSelect
            id="fromAccountId"
            name="fromAccountId"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="h-10"
          >
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} ({ACCOUNT_KIND_LABEL[a.kind]})
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field data-invalid={errors.to ? true : undefined}>
          <FieldLabel htmlFor="toAccountId">Para (entra aqui)</FieldLabel>
          <NativeSelect
            ref={toRef}
            id="toAccountId"
            name="toAccountId"
            value={to}
            onChange={(e) => {
              setTo(e.target.value);
              setErrors((x) => ({ ...x, to: undefined }));
            }}
            aria-invalid={errors.to ? true : undefined}
            aria-describedby={errors.to ? "to-error" : "to-help"}
            className="h-10"
          >
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} ({ACCOUNT_KIND_LABEL[a.kind]})
              </option>
            ))}
          </NativeSelect>
          {errors.to ? (
            <FieldError id="to-error">{errors.to}</FieldError>
          ) : (
            <FieldDescription id="to-help">
              Pagar a fatura: daqui para a conta do cartão.
            </FieldDescription>
          )}
        </Field>
        <Field data-invalid={errors.amount ? true : undefined}>
          <FieldLabel htmlFor="transfer-amount">Valor</FieldLabel>
          <MoneyInput
            ref={amountRef}
            id="transfer-amount"
            name="amount"
            value={cents}
            onValueChange={(v) => {
              setCents(v);
              if (v > 0n) setErrors((x) => ({ ...x, amount: undefined }));
            }}
            aria-invalid={errors.amount ? true : undefined}
            aria-describedby={errors.amount ? "transfer-amount-error" : undefined}
            className="h-12 text-lg"
          />
          {errors.amount ? (
            <FieldError id="transfer-amount-error">{errors.amount}</FieldError>
          ) : null}
        </Field>
        <Field>
          <FieldLabel htmlFor="transfer-date">Data</FieldLabel>
          <Input
            id="transfer-date"
            name="occurredOn"
            type="date"
            defaultValue={today}
            className="focus-within:border-ring focus-within:ring-ring h-10 focus-within:ring-3"
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="transfer-method">Como</FieldLabel>
          <NativeSelect id="transfer-method" name="method" defaultValue="TRANSFER" className="h-10">
            {(["TRANSFER", "PIX", "BOLETO", "WITHDRAWAL"] as const).map((m) => (
              <option key={m} value={m}>
                {METHOD_LABEL[m]}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field>
          <FieldLabel htmlFor="transfer-description">Descrição</FieldLabel>
          <Input
            id="transfer-description"
            name="description"
            maxLength={200}
            placeholder="Transferência"
            className="h-10"
          />
        </Field>
        <Button type="submit" size="lg" className="h-11" disabled={pending}>
          {pending ? "Salvando…" : "Registrar transferência"}
        </Button>
      </FieldGroup>
    </form>
  );
}
