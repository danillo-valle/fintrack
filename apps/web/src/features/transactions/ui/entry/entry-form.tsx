"use client";

// O <form> do lançamento: os blocos na ordem do desenho. Os botões ficam fora (EntryActions),
// ligados pelo atributo form=, para o modal poder prendê-los no rodapé.
import { FormAlert } from "@/features/auth/ui/form-alert";
import {
  AmountAndDateFields,
  ClassificationFields,
  DescriptionField,
  KindField,
  MoreOptionsFields,
  PaymentFields,
} from "./entry-fields";
import { useEntry } from "./entry-provider";

export function EntryForm() {
  const e = useEntry();
  return (
    <form
      id={e.formId}
      action={e.action}
      noValidate
      className="flex flex-col gap-3.5"
      onSubmit={(event) => {
        if (!e.validate()) event.preventDefault();
      }}
    >
      <FormAlert message={e.state.error} />
      {e.editing ? (
        <FormAlert message={e.state.error ? null : e.state.success} variant="success" />
      ) : null}
      {e.existing ? <input type="hidden" name="transactionId" value={e.existing.id} /> : null}
      <KindField />
      <AmountAndDateFields />
      <DescriptionField />
      <ClassificationFields />
      <PaymentFields />
      <MoreOptionsFields />
    </form>
  );
}
