import { RouteModal } from "@/components/ui/route-modal";
import { getExplanationPage } from "@/features/bank/server/review";
import { StepFooter } from "@/features/bank/ui/form-footer";
import {
  ExplanationBody,
  explanationSubtitle,
  explanationTitle,
} from "@/features/bank/ui/review/explanation";
import { ExplanationConfirmForm } from "@/features/bank/ui/review/explanation-confirm-form";
import { requireUser } from "@/lib/auth/session";

// "Por que essa categoria?" em modal, por cima da revisão (pranchas F-Sugestoes e F-CelSugestoes;
// no celular, o painel que sobe da base). "Escolher outra" fecha e volta para a linha, onde a
// categoria se troca em um clique.
export default async function ExplanationModal({
  params,
}: PageProps<"/lancamentos/recebidos/por-que/[receivedId]">) {
  const session = await requireUser();
  const { receivedId } = await params;
  const page = await getExplanationPage(session, receivedId);
  if (!page) {
    return (
      <RouteModal title="Por que essa categoria?">
        <p className="text-sm">
          Esse lançamento não está mais aqui: foi apagado, é uma transferência, ou está numa
          carteira que você não vê.
        </p>
      </RouteModal>
    );
  }
  const category = page.transaction.category;
  return (
    <RouteModal
      title={explanationTitle(page)}
      eyebrow={explanationSubtitle(page)}
      footer={
        page.canConfirm && category ? (
          <StepFooter
            formId="modal-form-por-que"
            submitLabel={`Confirmar ${category.name}`}
            submitIcon="confirmar"
            backLabel="Escolher outra"
            backHref="/lancamentos/recebidos"
            closesModal
          />
        ) : undefined
      }
    >
      {page.canConfirm ? (
        <ExplanationConfirmForm
          formId="modal-form-por-que"
          transactionId={page.transaction.id}
          walletId={page.transaction.walletId}
        />
      ) : null}
      <ExplanationBody page={page} />
    </RouteModal>
  );
}
