"use client";

// Nova categoria e nova regra (M07).
import { ActionForm } from "@/components/feedback/action-form";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { createCategoryAction, createRuleAction } from "../server/actions";

type Category = { id: string; name: string; kind: "EXPENSE" | "INCOME" };

export function CategoryForm({ parents }: { parents: Category[] }) {
  return (
    <ActionForm
      action={createCategoryAction}
      idPrefix="cat-"
      className="flex max-w-md flex-col gap-4"
    >
      {({ pending, field }) => {
        const name = field("name");
        return (
          <>
            <Field data-invalid={name.error ? true : undefined}>
              <FieldLabel htmlFor="cat-nome">Nome</FieldLabel>
              <Input
                id="cat-nome"
                name="name"
                required
                maxLength={60}
                data-msg-missing="Dê um nome à categoria."
                className="h-10"
                {...name.props}
              />
              <FieldError id={name.errorId}>{name.error}</FieldError>
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="cat-tipo">Tipo</FieldLabel>
                <NativeSelect id="cat-tipo" name="kind" defaultValue="EXPENSE" className="h-10">
                  <option value="EXPENSE">Despesa</option>
                  <option value="INCOME">Receita</option>
                </NativeSelect>
              </Field>
              <Field>
                <FieldLabel htmlFor="cat-pai">Dentro de (opcional)</FieldLabel>
                <NativeSelect id="cat-pai" name="parentId" defaultValue="" className="h-10">
                  <option value="">Nenhuma (categoria principal)</option>
                  {parents.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
            </div>
            <Button type="submit" className="self-start" disabled={pending}>
              {pending ? "Criando…" : "Criar categoria"}
            </Button>
          </>
        );
      }}
    </ActionForm>
  );
}

export function RuleForm({ categories }: { categories: Category[] }) {
  return (
    <ActionForm
      action={createRuleAction}
      idPrefix="regra-"
      className="flex max-w-md flex-col gap-4"
    >
      {({ pending, field }) => {
        const pattern = field("pattern", { helpId: "regra-texto-help" });
        return (
          <>
            <div className="grid gap-4 sm:grid-cols-[auto_1fr]">
              <Field>
                <FieldLabel htmlFor="regra-como">Se a descrição</FieldLabel>
                <NativeSelect id="regra-como" name="match" defaultValue="CONTAINS" className="h-10">
                  <option value="CONTAINS">contém</option>
                  <option value="STARTS_WITH">começa com</option>
                  <option value="EQUALS">é igual a</option>
                </NativeSelect>
              </Field>
              <Field data-invalid={pattern.error ? true : undefined}>
                <FieldLabel htmlFor="regra-texto">Texto</FieldLabel>
                <Input
                  id="regra-texto"
                  name="pattern"
                  required
                  minLength={2}
                  maxLength={100}
                  placeholder="Ex.: mercado"
                  data-msg-missing="Digite o texto que a descrição precisa ter."
                  className="h-10"
                  {...pattern.props}
                />
                <FieldDescription id="regra-texto-help">
                  Sem diferença entre maiúscula, minúscula e acento.
                </FieldDescription>
                <FieldError id={pattern.errorId}>{pattern.error}</FieldError>
              </Field>
            </div>
            <Field>
              <FieldLabel htmlFor="regra-categoria">Então a categoria é</FieldLabel>
              <NativeSelect id="regra-categoria" name="categoryId" className="h-10">
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.kind === "EXPENSE" ? "despesa" : "receita"})
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Button type="submit" className="self-start" disabled={pending}>
              {pending ? "Criando…" : "Criar regra"}
            </Button>
          </>
        );
      }}
    </ActionForm>
  );
}
