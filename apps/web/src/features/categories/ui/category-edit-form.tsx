"use client";

// Editar categoria (M13.2, prancha M-Categoria): o nome e o tipo. Trocar o tipo só vale sem
// subcategorias e com os lançamentos do sinal certo: a tela avisa antes, o servidor confere.
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
import { updateCategoryAction } from "../server/actions";

const KINDS = [
  { value: "EXPENSE", label: "Despesa" },
  { value: "INCOME", label: "Receita" },
] as const;

export function CategoryEditForm({
  formId,
  category,
}: {
  formId: string;
  category: {
    id: string;
    name: string;
    kind: "EXPENSE" | "INCOME";
    parentName: string | null;
    transactionCount: number;
  };
}) {
  const prefix = `${formId}-`;
  return (
    <ActionForm
      action={updateCategoryAction}
      id={formId}
      idPrefix={prefix}
      aria-label="Editar categoria"
      className="flex flex-col gap-4"
    >
      {({ field }) => {
        const name = field("name");
        return (
          <>
            <input type="hidden" name="categoryId" value={category.id} />
            <Field data-invalid={name.error ? true : undefined}>
              <FieldLabel htmlFor={`${prefix}nome`}>Nome</FieldLabel>
              <Input
                id={`${prefix}nome`}
                name="name"
                required
                maxLength={60}
                defaultValue={category.name}
                data-msg-missing="Dê um nome à categoria."
                className="h-10"
                {...name.props}
              />
              <FieldError id={name.errorId}>{name.error}</FieldError>
            </Field>
            <FieldSet>
              <FieldLegend variant="label">Tipo</FieldLegend>
              <div className="bg-muted grid grid-cols-2 gap-1 rounded-xl p-1">
                {KINDS.map((k) => (
                  <label
                    key={k.value}
                    className="has-focus-visible:ring-ring text-muted-foreground has-checked:bg-card has-checked:text-foreground flex min-h-10 cursor-pointer items-center justify-center rounded-[0.5625rem] px-2 text-center text-sm font-semibold has-checked:font-bold has-checked:shadow-[0_1px_4px_rgb(10_13_40/0.12)] has-focus-visible:ring-3"
                  >
                    <input
                      type="radio"
                      name="kind"
                      value={k.value}
                      defaultChecked={category.kind === k.value}
                      className="sr-only"
                    />
                    {k.label}
                  </label>
                ))}
              </div>
              <FieldDescription>
                {category.parentName
                  ? `Subcategoria de ${category.parentName}: o tipo acompanha a de cima.`
                  : category.transactionCount > 0
                    ? `Tem ${category.transactionCount === 1 ? "1 lançamento" : `${category.transactionCount} lançamentos`}. Para trocar o tipo, todos precisam ser do tipo novo (saída é despesa, entrada é receita).`
                    : "Sem lançamentos: o tipo pode mudar à vontade."}
              </FieldDescription>
            </FieldSet>
          </>
        );
      }}
    </ActionForm>
  );
}
