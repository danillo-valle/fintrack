import type { Metadata } from "next";
import { getPairPage } from "@/features/bank/server/review";
import { StepFooter } from "@/components/feedback/step-footer";
import { PairDialogBody, pairSubtitle } from "@/features/bank/ui/review/pair-dialog-body";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/feedback/empty-state";
import { requireUser } from "@/lib/auth/session";
import { Link2 } from "lucide-react";

export const metadata: Metadata = { title: "Confirmar o par" };

// "Confirmar o par" na página inteira (recarregar ou abrir o link direto). Pela revisão, abre em
// modal por cima dela (@modal/(.)lancamentos/recebidos/par/[receivedId]). O seu lançamento vem em
// ?com=<id>: o par é sempre conferido de novo no servidor.
export default async function PairPage({
  params,
  searchParams,
}: PageProps<"/lancamentos/recebidos/par/[receivedId]">) {
  const session = await requireUser();
  const { receivedId } = await params;
  const com = (await searchParams).com;
  const ownId = typeof com === "string" ? com : "";
  const preview = await getPairPage(session, receivedId, ownId);
  return (
    <>
      <PageHeader
        help="recebidos"
        crumb={{ href: "/lancamentos/recebidos", label: "Recebidos do banco" }}
        title="Confirmar o par"
        description={preview ? pairSubtitle(preview) : undefined}
      />
      {preview ? (
        <div className="bg-card flex max-w-2xl flex-col gap-5 rounded-[1.25rem] border p-4 md:p-6">
          <PairDialogBody preview={preview} formId="form-par" />
          <StepFooter
            formId="form-par"
            submitLabel="Confirmar par"
            submitIcon="confirmar"
            backLabel="Cancelar"
            backHref="/lancamentos/recebidos"
          />
        </div>
      ) : (
        <PairGone />
      )}
    </>
  );
}

function PairGone() {
  return (
    <EmptyState
      icon={Link2}
      title="Esse par não está mais na revisão"
      description="O recebido já foi conferido, ou os dois lançamentos mudaram. Volte para Recebidos do banco."
    />
  );
}
