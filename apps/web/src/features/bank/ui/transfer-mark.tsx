// A transferência de um recebido (M13.2): a ligada aos dois lados mostra só o rótulo; a marcada de
// um lado só diz para onde foi e tem o "Desmarcar" (volta a pedir a categoria).
import { ArrowLeftRight } from "lucide-react";
import type { ReceivedView } from "../server/review";
import { ActionButton } from "@/components/feedback/action-button";
import { markTransferAction } from "../server/actions";

type TransferPeer = NonNullable<ReceivedView["transferPeer"]>;

const PEER_TEXT: Record<TransferPeer, string> = {
  HOUSEHOLD: "para alguém do lar",
  EXTERNAL: "para uma conta sua fora do FinTrack",
};

export function TransferMark({
  item,
  canEdit,
}: {
  item: { id: string; description: string; transferPeer: TransferPeer | null };
  canEdit: boolean;
}) {
  return (
    <span className="flex min-h-11 flex-wrap items-center gap-x-2 gap-y-1 text-sm">
      <span className="inline-flex items-center gap-1.5 font-semibold">
        <ArrowLeftRight aria-hidden className="text-chart-1-ink size-4" />
        Transferência
        {item.transferPeer ? (
          <span className="text-muted-foreground font-normal">{PEER_TEXT[item.transferPeer]}</span>
        ) : null}
      </span>
      {item.transferPeer && canEdit ? (
        <ActionButton
          action={markTransferAction}
          fields={{ intent: "unmark", transactionId: item.id }}
          label={`Desmarcar a transferência de ${item.description}`}
          variant="ghost"
          className="h-9 px-2 text-sm"
        >
          Desmarcar
        </ActionButton>
      ) : null}
    </span>
  );
}
