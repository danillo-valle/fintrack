import { StepFooter } from "@/components/feedback/step-footer";
import { RouteModal } from "@/components/ui/route-modal";
import { getRecurrenceEditPage } from "@/features/transactions/server/queries";
import { RecurrenceEditForm } from "@/features/transactions/ui/repeat/recurrence-edit-form";
import { requireUser } from "@/lib/auth/session";

// Mudar o valor em modal (M13.3c, Fixas e parcelas, ⋯), por cima da lista. Dando certo, a action
// volta para a lista com o aviso no topo e a linha marcada.
export default async function RecurrenceEditModal({ params }: PageProps<"/fixas/[recurrenceId]">) {
  const session = await requireUser();
  const { recurrenceId } = await params;
  const recurrence = await getRecurrenceEditPage(session, recurrenceId);
  if (!recurrence) {
    return (
      <RouteModal title="Mudar o valor">
        <p className="text-sm">
          Esta recorrência não pode ser mudada aqui: ela é de outra carteira, foi encerrada ou não
          existe.
        </p>
      </RouteModal>
    );
  }
  return (
    <RouteModal
      title="Mudar o valor"
      eyebrow={recurrence.description}
      footer={
        <StepFooter
          formId="modal-form-mudar-valor"
          submitLabel="Salvar"
          submitIcon="confirmar"
          backLabel="Cancelar"
          backHref="/fixas"
          closesModal
        />
      }
    >
      <RecurrenceEditForm formId="modal-form-mudar-valor" recurrence={recurrence} />
    </RouteModal>
  );
}
