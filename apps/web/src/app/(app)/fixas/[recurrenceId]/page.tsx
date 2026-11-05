import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { StepFooter } from "@/components/feedback/step-footer";
import { PageHeader } from "@/components/layout/page-header";
import { getRecurrenceEditPage } from "@/features/transactions/server/queries";
import { RecurrenceEditForm } from "@/features/transactions/ui/repeat/recurrence-edit-form";
import { requireUser } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Mudar o valor" };

// Mudar o valor na página inteira (M13.3c; recarregar ou abrir o link direto). Pelo menu "⋯" de
// Fixas e parcelas, abre em modal (@modal/(.)fixas/[recurrenceId]). Recorrência de outra pessoa,
// encerrada ou inventada: 404 igual.
export default async function RecurrenceEditPage({ params }: PageProps<"/fixas/[recurrenceId]">) {
  const session = await requireUser();
  const { recurrenceId } = await params;
  const recurrence = await getRecurrenceEditPage(session, recurrenceId);
  if (!recurrence) notFound();
  return (
    <>
      <PageHeader
        help="parcelada-e-fixa"
        crumb={{ href: "/fixas", label: "Fixas e parcelas" }}
        title="Mudar o valor"
        description={recurrence.description}
      />
      <div className="bg-card flex max-w-2xl flex-col gap-5 rounded-[1.25rem] border p-4 md:p-6">
        <RecurrenceEditForm formId="form-mudar-valor" recurrence={recurrence} />
        <StepFooter
          formId="form-mudar-valor"
          submitLabel="Salvar"
          submitIcon="confirmar"
          backLabel="Cancelar"
          backHref="/fixas"
        />
      </div>
    </>
  );
}
