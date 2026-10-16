import type { Metadata } from "next";
import { CircleHelp } from "lucide-react";
import { EmptyState } from "@/components/feedback/empty-state";
import { PageHeader } from "@/components/layout/page-header";
import { getExplanationPage } from "@/features/bank/server/review";
import { StepFooter } from "@/features/bank/ui/form-footer";
import {
  ExplanationBody,
  explanationSubtitle,
  explanationTitle,
} from "@/features/bank/ui/review/explanation";
import { ExplanationConfirmForm } from "@/features/bank/ui/review/explanation-confirm-form";
import { requireUser } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Por que essa categoria?" };

// "Por que essa categoria?" na página inteira (recarregar ou abrir o link direto). Pela revisão,
// abre em modal por cima dela (@modal/(.)lancamentos/recebidos/por-que/[receivedId]): no celular,
// o painel que sobe da base (prancha F-CelSugestoes).
export default async function ExplanationPage({
  params,
}: PageProps<"/lancamentos/recebidos/por-que/[receivedId]">) {
  const session = await requireUser();
  const { receivedId } = await params;
  const page = await getExplanationPage(session, receivedId);
  if (!page) {
    return (
      <>
        <PageHeader
          crumb={{ href: "/lancamentos/recebidos", label: "Recebidos do banco" }}
          title="Por que essa categoria?"
        />
        <EmptyState
          icon={CircleHelp}
          title="Esse lançamento não está aqui"
          description="Ele foi apagado, é uma transferência, ou está numa carteira que você não vê. Volte para Recebidos do banco."
        />
      </>
    );
  }
  return (
    <>
      <PageHeader
        crumb={{ href: "/lancamentos/recebidos", label: "Recebidos do banco" }}
        title={explanationTitle(page)}
        description={explanationSubtitle(page)}
      />
      <div className="bg-card flex max-w-2xl flex-col gap-5 rounded-[1.25rem] border p-4 md:p-6">
        {page.canConfirm ? (
          <ExplanationConfirmForm
            formId="form-por-que"
            transactionId={page.transaction.id}
            walletId={page.transaction.walletId}
          />
        ) : null}
        <ExplanationBody page={page} />
        {page.canConfirm && page.transaction.category ? (
          <StepFooter
            formId="form-por-que"
            submitLabel={`Confirmar ${page.transaction.category.name}`}
            submitIcon="confirmar"
            backLabel="Escolher outra"
            backHref="/lancamentos/recebidos"
          />
        ) : null}
      </div>
    </>
  );
}
