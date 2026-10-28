"use client";

// Adicionar cartão numa conta (M07; em modal desde o M12.3a, prancha J-AdicionarCartao). Só os 4
// últimos dígitos: o número inteiro, a validade e o CVV nunca entram no FinTrack (o banco recusa
// qualquer coisa que não sejam 4 dígitos). O botão fica no rodapé (form="…").
import { ActionForm } from "@/components/feedback/action-form";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { CARD_FORM_LABEL } from "@/lib/labels";
import { createCardAction } from "../server/actions";

export function CardForm({
  formId,
  walletId,
  accountId,
  people,
  me,
  back,
}: {
  formId: string;
  walletId: string;
  accountId: string;
  people: { userId: string; name: string }[];
  me: string;
  /** Para onde voltar depois de cadastrar: a lista de contas ou a página da conta */
  back: "contas" | "conta";
}) {
  const prefix = `${formId}-`;
  return (
    <ActionForm
      action={createCardAction}
      id={formId}
      idPrefix={prefix}
      aria-label="Adicionar cartão"
      className="flex flex-col gap-4"
    >
      {({ field }) => {
        const nickname = field("nickname");
        const brand = field("brand");
        const last = field("lastFour", { helpId: `${prefix}final-help` });
        return (
          <>
            <input type="hidden" name="walletId" value={walletId} />
            <input type="hidden" name="accountId" value={accountId} />
            <input type="hidden" name="volta" value={back} />
            <div className="grid gap-4 sm:grid-cols-3">
              <Field data-invalid={nickname.error ? true : undefined}>
                <FieldLabel htmlFor={`${prefix}apelido`}>Apelido</FieldLabel>
                <Input
                  id={`${prefix}apelido`}
                  name="nickname"
                  required
                  maxLength={60}
                  data-msg-missing="Dê um apelido ao cartão."
                  className="h-10"
                  {...nickname.props}
                />
                <FieldError id={nickname.errorId}>{nickname.error}</FieldError>
              </Field>
              <Field data-invalid={brand.error ? true : undefined}>
                <FieldLabel htmlFor={`${prefix}bandeira`}>Bandeira</FieldLabel>
                <Input
                  id={`${prefix}bandeira`}
                  name="brand"
                  required
                  minLength={2}
                  maxLength={30}
                  data-msg-missing="Informe a bandeira."
                  className="h-10"
                  {...brand.props}
                />
                <FieldError id={brand.errorId}>{brand.error}</FieldError>
              </Field>
              <Field data-invalid={last.error ? true : undefined}>
                <FieldLabel htmlFor={`${prefix}final`}>Final</FieldLabel>
                <Input
                  id={`${prefix}final`}
                  name="lastFour"
                  inputMode="numeric"
                  autoComplete="off"
                  required
                  pattern="[0-9]{4}"
                  maxLength={4}
                  data-msg-missing="Digite os 4 últimos dígitos."
                  data-msg-pattern="Digite só os 4 últimos dígitos."
                  className="h-10"
                  {...last.props}
                />
                <FieldDescription id={`${prefix}final-help`}>
                  Só os 4 últimos. Nunca o número inteiro, a validade ou o código de segurança.
                </FieldDescription>
                <FieldError id={last.errorId}>{last.error}</FieldError>
              </Field>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor={`${prefix}formato`}>Formato</FieldLabel>
                <NativeSelect
                  id={`${prefix}formato`}
                  name="form"
                  defaultValue="PHYSICAL"
                  className="h-10"
                >
                  {(Object.keys(CARD_FORM_LABEL) as (keyof typeof CARD_FORM_LABEL)[]).map((f) => (
                    <option key={f} value={f}>
                      {CARD_FORM_LABEL[f]}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field>
                <FieldLabel htmlFor={`${prefix}portador`}>Quem usa (portador)</FieldLabel>
                <NativeSelect
                  id={`${prefix}portador`}
                  name="holderId"
                  defaultValue={me}
                  className="h-10"
                >
                  {people.map((p) => (
                    <option key={p.userId} value={p.userId}>
                      {p.name}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                name="isAdditional"
                className="accent-primary focus-visible:ring-ring size-4 rounded outline-none focus-visible:ring-3"
              />
              Cartão adicional (o portador lança com ele sem ver o resto da fatura)
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                name="sharedPurchases"
                className="accent-primary focus-visible:ring-ring size-4 rounded outline-none focus-visible:ring-3"
              />
              Cartão de compras conjuntas (em &quot;Pago por&quot;, as compras dele aparecem como
              Compartilhado)
            </label>
          </>
        );
      }}
    </ActionForm>
  );
}
