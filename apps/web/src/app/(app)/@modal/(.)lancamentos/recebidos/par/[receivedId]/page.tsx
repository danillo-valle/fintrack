import { RouteModal } from "@/components/ui/route-modal";
import { getPairPage } from "@/features/bank/server/review";
import { StepFooter } from "@/features/bank/ui/form-footer";
import { PairDialogBody, pairSubtitle } from "@/features/bank/ui/review/pair-dialog-body";
import { requireUser } from "@/lib/auth/session";

// "Confirmar o par" em modal, por cima da revisão (pranchas E2-Par e E2-CelPar; no celular, o
// painel que sobe da base). Cancelar fecha e volta para a revisão, no mesmo lugar.
export default async function PairModal({
  params,
  searchParams,
}: PageProps<"/lancamentos/recebidos/par/[receivedId]">) {
  const session = await requireUser();
  const { receivedId } = await params;
  const com = (await searchParams).com;
  const preview = await getPairPage(session, receivedId, typeof com === "string" ? com : "");
  if (!preview) {
    return (
      <RouteModal title="Confirmar o par">
        <p className="text-sm">
          Esse par não está mais na revisão: o recebido já foi conferido, ou os dois lançamentos
          mudaram.
        </p>
      </RouteModal>
    );
  }
  return (
    <RouteModal
      title="Confirmar o par"
      description={pairSubtitle(preview)}
      footer={
        <StepFooter
          formId="modal-form-par"
          submitLabel="Confirmar par"
          submitIcon="confirmar"
          backLabel="Cancelar"
          backHref="/lancamentos/recebidos"
          closesModal
        />
      }
    >
      <PairDialogBody preview={preview} formId="modal-form-par" />
    </RouteModal>
  );
}
