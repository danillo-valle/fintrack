"use client";

// "Criar e aplicar" a categoria que a IA local propôs (M10.2b, pranchas F2-Recebidos e
// F2-CelCriar). A pessoa pode trocar o nome e a mãe; o botão fica no rodapé (form="…"). Deu certo:
// volta para a revisão com o aviso. Deu errado (nome ocupado, já resolvido): aviso aqui.
// Nada é confirmado aqui: os recebidos continuam esperando o Confirmar.
import { Sparkles } from "lucide-react";
import { ActionForm } from "@/components/feedback/action-form";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { applyLocalAiProposalAction } from "../../server/review-actions";
import { dayMonth } from "./parts";

export type ProposalFormData = {
  transaction: { id: string };
  name: string;
  parent: { id: string; name: string } | null;
  parents: readonly { id: string; name: string }[];
  siblings: readonly { id: string; description: string; occurredOn: string }[];
};

export function ProposalForm({ formId, page }: { formId: string; page: ProposalFormData }) {
  const prefix = `${formId}-`;
  const count = page.siblings.length;
  return (
    <ActionForm
      action={applyLocalAiProposalAction}
      id={formId}
      idPrefix={prefix}
      aria-label="Criar e aplicar a categoria proposta"
      className="flex flex-col gap-3.5"
    >
      {({ field }) => {
        const name = field("name", { helpId: `${prefix}nome-ajuda` });
        return (
          <>
            <input type="hidden" name="transactionId" value={page.transaction.id} />
            <p className="flex gap-2 text-sm">
              <Sparkles aria-hidden className="text-chart-1-ink mt-0.5 size-[1.125rem] shrink-0" />
              Nenhuma categoria da casa serviu. A IA local propôs uma nova:
            </p>
            <Field data-invalid={name.error ? true : undefined}>
              <FieldLabel htmlFor={`${prefix}nome`}>Nome</FieldLabel>
              <Input
                id={`${prefix}nome`}
                name="name"
                required
                maxLength={60}
                defaultValue={page.name}
                autoComplete="off"
                data-msg-missing="Dê um nome à categoria."
                className="h-11"
                {...name.props}
              />
              <FieldError id={name.errorId}>{name.error}</FieldError>
              <FieldDescription id={`${prefix}nome-ajuda`}>
                Trocar o nome faz a escolha ser sua (aparece como “Você”).
              </FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor={`${prefix}mae`}>Dentro de</FieldLabel>
              <NativeSelect
                id={`${prefix}mae`}
                name="parentId"
                defaultValue={page.parent?.id ?? ""}
                className="h-11 rounded-xl"
              >
                <option value="">Nenhuma (categoria principal)</option>
                {page.parents.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <div className="bg-muted/50 flex flex-col gap-1 rounded-xl border px-3 py-2.5 text-[0.8125rem]">
              <strong className="text-sm">
                Aplica em {count === 1 ? "1 recebido" : `${count} recebidos`} com essa proposta
              </strong>
              <ul className="flex flex-col gap-0.5">
                {page.siblings.slice(0, 5).map((t) => (
                  <li key={t.id} className="truncate">
                    {t.description} · <span className="tabular">{dayMonth(t.occurredOn)}</span>
                  </li>
                ))}
                {count > 5 ? <li>e mais {count - 5}</li> : null}
              </ul>
            </div>
            <p className="text-muted-foreground text-[0.8125rem]">
              Nada é criado sem você. Os recebidos continuam esperando o seu Confirmar. A categoria
              nova aparece em Ajustes › Categorias.
            </p>
          </>
        );
      }}
    </ActionForm>
  );
}
