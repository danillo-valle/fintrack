"use client";

// O <form> do lançamento: os blocos na ordem do desenho. Em tela baixa (variante compact, só no
// modal), os blocos e os rótulos ficam mais juntos, para caber sem barra de rolagem. Os botões ficam fora (EntryActions),
// ligados pelo atributo form=, para o modal poder prendê-los no rodapé.
import { FormAlert } from "@/features/auth/ui/form-alert";
import {
  AmountAndDateFields,
  ClassificationFields,
  DescriptionField,
  ExpenseTypeField,
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
      className="compact:gap-2 compact:**:data-[slot=field]:gap-1 flex flex-col gap-3"
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
      <ExpenseTypeField />
      <ClassificationFields />
      <PaymentFields />
      <MoreOptionsFields />
    </form>
  );
}
