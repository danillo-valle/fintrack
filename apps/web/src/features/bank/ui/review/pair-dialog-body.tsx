// O miolo do "Confirmar o par", igual no modal e na página inteira (M09.2).
import type { PairPreview } from "../../server/review";
import { formatBRL } from "@/lib/money";
import { dayMonth } from "./parts";
import { PairCompare } from "./pair-compare";
import { PairConfirmForm } from "./pair-confirm-form";

/** "Mercado · 13/10 · R$ 312,48": a categoria (ou a descrição), a data e o valor do banco. */
export function pairSubtitle(preview: PairPreview) {
  const name = preview.result.categoryId
    ? ((preview.own.category ?? preview.received.category)?.name ?? preview.own.description)
    : preview.own.description;
  const cents = preview.received.amount;
  return `${name} · ${dayMonth(preview.received.occurredOn)} · ${formatBRL(cents < 0n ? -cents : cents)}`;
}

export function PairDialogBody({ preview, formId }: { preview: PairPreview; formId: string }) {
  return (
    <div className="flex flex-col gap-3">
      <PairConfirmForm formId={formId} receivedId={preview.received.id} ownId={preview.own.id} />
      <PairCompare preview={preview} />
    </div>
  );
}
