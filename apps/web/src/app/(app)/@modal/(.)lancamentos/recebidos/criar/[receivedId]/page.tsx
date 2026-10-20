import { RouteModal } from "@/components/ui/route-modal";
import { getProposalPage } from "@/features/bank/server/review";
import { StepFooter } from "@/features/bank/ui/form-footer";
import { ProposalForm } from "@/features/bank/ui/review/proposal-form";
import { proposalSubtitle, proposalTitle } from "@/features/bank/ui/review/proposal-text";
import { requireUser } from "@/lib/auth/session";

// "Criar e aplicar" em modal, por cima da revisão (pranchas F2-Recebidos e F2-CelCriar; no
// celular, o painel que sobe da base). "Escolher uma que já existe" fecha e volta para a linha,
// onde a categoria se escolhe em um clique.
export default async function ProposalModal({
  params,
}: PageProps<"/lancamentos/recebidos/criar/[receivedId]">) {
  const session = await requireUser();
  const { receivedId } = await params;
  const page = await getProposalPage(session, receivedId);
  if (!page) {
    return (
      <RouteModal title="Criar a categoria proposta">
        <p className="text-sm">
          Essa proposta não está mais aqui: o recebido já ganhou categoria, foi conferido, ou você
          não mexe nas categorias do lar.
        </p>
      </RouteModal>
    );
  }
  return (
    <RouteModal
      title={proposalTitle(page)}
      eyebrow={proposalSubtitle(page)}
      footer={
        <StepFooter
          formId="modal-form-criar"
          submitLabel="Criar e aplicar"
          submitIcon="confirmar"
          backLabel="Escolher uma que já existe"
          backHref="/lancamentos/recebidos"
          closesModal
        />
      }
    >
      <ProposalForm formId="modal-form-criar" page={page} />
    </RouteModal>
  );
}
