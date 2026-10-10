import { SegmentedNav } from "@/components/visual/segmented-nav";
import type { getBudgetEditor } from "../server/queries";
import { BudgetForm } from "./budget-form";

type Editor = NonNullable<Awaited<ReturnType<typeof getBudgetEditor>>>;

// O miolo de "Editar valores", o mesmo no modal e na página inteira: o ambiente (quando a pessoa
// edita mais de um) e o formulário da categoria.
export function BudgetEditor({ editor, idPrefix }: { editor: Editor; idPrefix: string }) {
  return (
    <div className="flex flex-col gap-4">
      {editor.environments.length > 1 ? (
        <SegmentedNav
          label="Ambiente"
          items={editor.environments.map((e) => ({
            href: editor.hrefFor(e.id),
            label: e.name,
            active: e.id === editor.walletId,
          }))}
        />
      ) : null}
      <BudgetForm
        // Trocar de ambiente recria o formulário com os valores do outro ambiente
        key={editor.walletId}
        idPrefix={idPrefix}
        walletId={editor.walletId}
        month={editor.month}
        shared={editor.shared}
        categories={editor.categories}
        categoryId={editor.categoryId}
        budgets={editor.budgets}
        payers={editor.shared ? editor.payers : []}
        split={editor.split}
        backHref={editor.backHref}
      />
    </div>
  );
}
