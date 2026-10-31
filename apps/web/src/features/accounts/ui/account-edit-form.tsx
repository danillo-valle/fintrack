"use client";

// Editar conta (M13.2, prancha M-EditarConta): o apelido que o FinTrack mostra e, numa conta
// manual, o tipo entre corrente, poupança e dinheiro. Numa conta ligada ao banco, o tipo vem do
// banco e aparece só para ler. O botão fica no rodapé (form="…").
import { SWITCHABLE_ACCOUNT_KINDS, type AccountKind } from "@fintrack/core";
import { ActionForm } from "@/components/feedback/action-form";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { ACCOUNT_KIND_LABEL } from "@/lib/labels";
import { updateAccountAction } from "../server/actions";

export function AccountEditForm({
  formId,
  walletId,
  account,
}: {
  formId: string;
  walletId: string;
  account: {
    id: string;
    name: string;
    kind: AccountKind;
    institution: string | null;
    connected: boolean;
  };
}) {
  const prefix = `${formId}-`;
  const switchable = !account.connected && SWITCHABLE_ACCOUNT_KINDS.includes(account.kind);
  return (
    <ActionForm
      action={updateAccountAction}
      id={formId}
      idPrefix={prefix}
      aria-label="Editar conta"
      className="flex flex-col gap-4"
    >
      {({ field }) => {
        const name = field("name", { helpId: `${prefix}apelido-help` });
        return (
          <>
            <input type="hidden" name="walletId" value={walletId} />
            <input type="hidden" name="accountId" value={account.id} />
            <Field data-invalid={name.error ? true : undefined}>
              <FieldLabel htmlFor={`${prefix}apelido`}>Apelido</FieldLabel>
              <Input
                id={`${prefix}apelido`}
                name="name"
                required
                maxLength={60}
                defaultValue={account.name}
                data-msg-missing="Dê um apelido à conta."
                className="h-10"
                {...name.props}
              />
              <FieldDescription id={`${prefix}apelido-help`}>
                O nome que aparece no FinTrack, inclusive no que já foi confirmado.
              </FieldDescription>
              <FieldError id={name.errorId}>{name.error}</FieldError>
            </Field>
            {account.connected ? (
              <Field>
                <FieldLabel htmlFor={`${prefix}banco`}>Banco</FieldLabel>
                <Input
                  id={`${prefix}banco`}
                  value={account.institution ?? "Meu Pluggy"}
                  readOnly
                  aria-describedby={`${prefix}banco-help`}
                  className="bg-muted text-muted-foreground h-10"
                />
                <FieldDescription id={`${prefix}banco-help`}>
                  Ligada pelo Meu Pluggy. Os lançamentos continuam chegando para esta conta.
                </FieldDescription>
              </Field>
            ) : null}
            {switchable ? (
              <FieldSet>
                <FieldLegend variant="label">Tipo</FieldLegend>
                <div className="bg-muted grid grid-cols-3 gap-1 rounded-xl p-1">
                  {SWITCHABLE_ACCOUNT_KINDS.map((k) => (
                    <label
                      key={k}
                      className="has-focus-visible:ring-ring text-muted-foreground has-checked:bg-card has-checked:text-foreground flex min-h-10 cursor-pointer items-center justify-center rounded-[0.5625rem] px-2 text-center text-sm font-semibold has-checked:font-bold has-checked:shadow-[0_1px_4px_rgb(10_13_40/0.12)] has-focus-visible:ring-3"
                    >
                      <input
                        type="radio"
                        name="kind"
                        value={k}
                        defaultChecked={account.kind === k}
                        className="sr-only"
                      />
                      {ACCOUNT_KIND_LABEL[k]}
                    </label>
                  ))}
                </div>
              </FieldSet>
            ) : (
              <Field>
                <input type="hidden" name="kind" value={account.kind} />
                <FieldLabel htmlFor={`${prefix}tipo`}>Tipo</FieldLabel>
                <Input
                  id={`${prefix}tipo`}
                  value={ACCOUNT_KIND_LABEL[account.kind]}
                  readOnly
                  aria-describedby={`${prefix}tipo-help`}
                  className="bg-muted text-muted-foreground h-10"
                />
                <FieldDescription id={`${prefix}tipo-help`}>
                  {account.connected
                    ? "Numa conta do banco, o tipo vem do banco."
                    : "Cartão e vale não trocam de tipo: os lançamentos deles seguem regras próprias."}
                </FieldDescription>
              </Field>
            )}
          </>
        );
      }}
    </ActionForm>
  );
}
