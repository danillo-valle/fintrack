import type { Metadata } from "next";
import { Sparkles } from "lucide-react";
import { EmptyState } from "@/components/feedback/empty-state";
import { PageHeader } from "@/components/layout/page-header";
import { getProposalPage } from "@/features/bank/server/review";
import { StepFooter } from "@/components/feedback/step-footer";
import { ProposalForm } from "@/features/bank/ui/review/proposal-form";
import { proposalSubtitle, proposalTitle } from "@/features/bank/ui/review/proposal-text";
import { requireUser } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Criar a categoria proposta" };

// "Criar e aplicar" na página inteira (recarregar ou abrir o link direto). Pela revisão, abre em
// modal por cima dela (@modal/(.)lancamentos/recebidos/criar/[receivedId]); no celular, o painel
// que sobe da base (prancha F2-CelCriar).
export default async function ProposalPage({
  params,
}: PageProps<"/lancamentos/recebidos/criar/[receivedId]">) {
  const session = await requireUser();
  const { receivedId } = await params;
  const page = await getProposalPage(session, receivedId);
  if (!page) {
    return (
      <>
        <PageHeader
          help="ia-local"
          crumb={{ href: "/lancamentos/recebidos", label: "Recebidos do banco" }}
          title="Criar a categoria proposta"
        />
        <EmptyState
          icon={Sparkles}
          title="Essa proposta não está mais aqui"
          description="O recebido já ganhou categoria, foi conferido, ou você não mexe nas categorias do lar. Volte para Recebidos do banco."
        />
      </>
    );
  }
  return (
    <>
      <PageHeader
        help="ia-local"
        crumb={{ href: "/lancamentos/recebidos", label: "Recebidos do banco" }}
        title={proposalTitle(page)}
        description={proposalSubtitle(page)}
      />
      <div className="bg-card flex max-w-xl flex-col gap-5 rounded-[1.25rem] border p-4 md:p-6">
        <ProposalForm formId="form-criar" page={page} />
        <StepFooter
          formId="form-criar"
          submitLabel="Criar e aplicar"
          submitIcon="confirmar"
          backLabel="Escolher uma que já existe"
          backHref="/lancamentos/recebidos"
        />
      </div>
    </>
  );
}
