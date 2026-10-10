import { RouteModal } from "@/components/ui/route-modal";
import { getBudgetEditor } from "@/features/budget/server/queries";
import { BudgetEditor } from "@/features/budget/ui/budget-editor";
import { requireUser } from "@/lib/auth/session";

// "Editar valores" em modal (M08): por cima do Orçamento, sem perder o lugar. Recarregar ou abrir
// /orcamento/editar direto mostra a página inteira, com as mesmas peças (BudgetEditor).
export default async function BudgetEditModal({ searchParams }: PageProps<"/orcamento/editar">) {
  const session = await requireUser(); // toda página do app começa conferindo a sessão
  const editor = await getBudgetEditor(session, await searchParams);

  if (!editor) {
    return (
      <RouteModal title="Editar valores">
        <p className="text-sm">Só o dono ou o editor de um ambiente muda o orçado dele.</p>
      </RouteModal>
    );
  }
  return (
    <RouteModal
      title="Editar valores"
      description={`No ambiente ${editor.walletName} · ${editor.monthLabel}`}
      initialFocus="#modal-orcado-categoria"
    >
      <BudgetEditor editor={editor} idPrefix="modal-orcado-" />
    </RouteModal>
  );
}
