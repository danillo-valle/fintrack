// Uma transferência sugerida (M13.2, prancha M-Revisao): a saída de uma conta ao lado da entrada na
// outra, do mesmo valor, com o motivo em cima e as duas saídas: "Não é transferência" e "Confirmar
// transferência" (ou "Confirmar pagamento", quando a entrada cai num cartão: o pagamento da fatura).
//
//   computador  [ Sai de ]  →  [ Entra em ]
//   celular     [ Sai de ]
//               [ Entra em ]
import { ArrowLeftRight, ArrowRight, CreditCard } from "lucide-react";
import type { TransferSideView, TransferView } from "../../server/review";
import { AmountText } from "@/components/money/amount-text";
import { ToneChip } from "@/components/visual/tone-chip";
import { dayMonth, SMALL_BUTTON, SMALL_PRIMARY } from "./parts";
import { ReviewForm, ReviewSubmit } from "./review-actions";

const shown = (side: TransferSideView) => side.label ?? side.description;

function Side({ title, side }: { title: string; side: TransferSideView }) {
  return (
    <div className="bg-muted/60 flex min-w-0 flex-col gap-1 rounded-[0.875rem] border px-3.5 py-3">
      <h3 className="text-muted-foreground text-[0.8125rem] font-bold tracking-[0.04em] uppercase">
        {title}
      </h3>
      <strong className="truncate">{side.account.name}</strong>
      <span className="text-muted-foreground truncate text-sm">{shown(side)}</span>
      <span className="mt-1 flex items-center justify-between gap-2">
        <span className="text-muted-foreground tabular font-mono text-sm">
          {dayMonth(side.occurredOn)}
          {side.pending ? "" : " · já conferido"}
        </span>
        <AmountText cents={side.amount} tone="inherit" arrow={false} className="font-bold" />
      </span>
    </div>
  );
}

export function TransferCard({ transfer }: { transfer: TransferView }) {
  const { out, in: into, billPayment } = transfer;
  const days =
    transfer.daysApart === 0
      ? "mesmo valor, mesmo dia"
      : `mesmo valor, ${transfer.daysApart === 1 ? "1 dia" : `${transfer.daysApart} dias`} entre os dois`;
  const title = billPayment ? "Pagamento de fatura" : "Transferência";
  const ids = { outId: out.id, inId: into.id };
  return (
    <article
      aria-label={`${title}: de ${out.account.name} para ${into.account.name}`}
      className="bg-card flex flex-col gap-3 rounded-[1.125rem] border p-3.5"
      data-testid="transferencia-sugerida"
    >
      <div className="flex flex-wrap items-center gap-2">
        <ToneChip tone={billPayment ? 4 : 1} icon={billPayment ? CreditCard : ArrowLeftRight}>
          {title}
        </ToneChip>
        <span className="text-muted-foreground text-sm">
          {days}
          {billPayment ? " · não conta como gasto: as compras já contam pelo cartão" : ""}
        </span>
      </div>
      <div className="flex flex-col gap-2 md:grid md:grid-cols-[minmax(0,1fr)_1.75rem_minmax(0,1fr)] md:items-center md:gap-2.5">
        <Side title="Sai de" side={out} />
        <span aria-hidden className="text-muted-foreground grid justify-items-center">
          <ArrowRight className="size-5 max-md:rotate-90" />
        </span>
        <Side title={billPayment ? "Paga a fatura de" : "Entra em"} side={into} />
      </div>
      <div className="grid grid-cols-2 gap-2 md:flex md:justify-end">
        <ReviewForm intent="transfer-reject" fields={ids} className="grid">
          <ReviewSubmit
            className={SMALL_BUTTON}
            label={`Não é transferência: ${out.account.name} e ${into.account.name}`}
          >
            Não é transferência
          </ReviewSubmit>
        </ReviewForm>
        <ReviewForm intent="transfer" fields={ids} className="grid">
          <ReviewSubmit className={SMALL_PRIMARY}>
            {billPayment ? "Confirmar pagamento" : "Confirmar transferência"}
          </ReviewSubmit>
        </ReviewForm>
      </div>
    </article>
  );
}
