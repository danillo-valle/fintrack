// Um par sugerido (M09.2, prancha E2-Revisao): o seu lançamento ao lado do que veio do banco,
// com o motivo da sugestão em cima ("Mesmo valor, 1 dia depois", "Parcela 3 de 10", "Estorno da
// compra de 05/10") e as duas saídas: "Não é o mesmo" e "Confirmar par" (ou "Ligar ao original").
//
//   computador  [ Seu lançamento ]  🔗  [ Do banco ]
//   celular     [ Seu lançamento ]
//               [ Do banco ]
import Link from "next/link";
import { CircleDashed, Clock, Link2, RefreshCw, type LucideIcon } from "lucide-react";
import type { PairView } from "../../server/review";
import { AmountText } from "@/components/money/amount-text";
import { ToneChip } from "@/components/visual/tone-chip";
import { CardChip, CategoryLabel, dayMonth, SMALL_BUTTON, SMALL_PRIMARY } from "./parts";
import { ReviewForm, ReviewSubmit } from "./review-actions";

/** O motivo da sugestão, como o canvas escreve. */
export function pairReason(pair: Pick<PairView, "kind" | "daysApart" | "received" | "own">): {
  text: string;
  icon: LucideIcon;
} {
  if (pair.kind === "INSTALLMENT" && pair.received.installment) {
    const { number, count } = pair.received.installment;
    return { text: `Parcela ${number} de ${count}`, icon: Clock };
  }
  if (pair.kind === "REFUND")
    return { text: `Estorno da compra de ${dayMonth(pair.own.occurredOn)}`, icon: RefreshCw };
  if (pair.daysApart === 0) return { text: "Mesmo valor, mesmo dia", icon: Link2 };
  const after = pair.received.occurredOn > pair.own.occurredOn;
  const days = pair.daysApart === 1 ? "1 dia" : `${pair.daysApart} dias`;
  return { text: `Mesmo valor, ${days} ${after ? "depois" : "antes"}`, icon: Link2 };
}

type Row = { label: string; value: React.ReactNode };

function Side({ title, rows }: { title: string; rows: Row[] }) {
  return (
    <div className="bg-muted/60 flex min-w-0 flex-col gap-1 rounded-[0.875rem] border px-3.5 py-3">
      <h3 className="text-muted-foreground text-[0.8125rem] font-bold tracking-[0.04em] uppercase">
        {title}
      </h3>
      <dl className="flex flex-col">
        {rows.map(({ label, value }) => (
          <div
            key={label}
            className="grid min-h-7 grid-cols-[5.25rem_minmax(0,1fr)] items-center gap-2"
          >
            <dt className="text-muted-foreground text-xs">{label}</dt>
            <dd className="min-w-0 text-sm">{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

export function PairCard({ pair }: { pair: PairView }) {
  const { received, own } = pair;
  const reason = pairReason(pair);
  const refund = pair.kind === "REFUND";
  const amount = (cents: bigint) => (
    <AmountText cents={cents} tone="inherit" arrow={false} className="font-bold" />
  );
  return (
    <article
      aria-label={`${reason.text}: ${own.description} e ${received.description}`}
      className="bg-card flex flex-col gap-3 rounded-[1.125rem] border p-3.5"
      data-testid="par-sugerido"
    >
      <div className="flex items-center gap-2">
        <ToneChip tone={1} icon={reason.icon}>
          {reason.text}
        </ToneChip>
      </div>
      <div className="flex flex-col gap-2 md:grid md:grid-cols-[minmax(0,1fr)_1.75rem_minmax(0,1fr)] md:items-center md:gap-2.5">
        <Side
          title={refund ? "A compra" : "Seu lançamento"}
          rows={[
            {
              label: "Descrição",
              value: <span className="font-semibold break-words">{own.description}</span>,
            },
            {
              label: "Data",
              value: <span className="tabular font-mono">{dayMonth(own.occurredOn)}</span>,
            },
            {
              label: "Categoria",
              value: <CategoryLabel category={own.category} categorizedBy={own.categorizedBy} />,
            },
            { label: "Ambiente", value: own.wallet.name },
            { label: "Valor", value: amount(own.amount) },
          ]}
        />
        <span aria-hidden className="text-muted-foreground hidden justify-items-center md:grid">
          <Link2 className="size-5" />
        </span>
        <Side
          title="Do banco"
          rows={[
            {
              label: "Descrição",
              value: <span className="font-semibold break-words">{received.description}</span>,
            },
            {
              label: "Data",
              value: <span className="tabular font-mono">{dayMonth(received.occurredOn)}</span>,
            },
            {
              label: "Cartão",
              value:
                received.card || received.unknownLastFour ? (
                  <CardChip card={received.card} unknownLastFour={received.unknownLastFour} />
                ) : (
                  received.account.name
                ),
            },
            {
              label: "Situação",
              value: (
                <ToneChip tone={4} icon={CircleDashed}>
                  Recebido
                </ToneChip>
              ),
            },
            { label: "Valor", value: amount(received.amount) },
          ]}
        />
      </div>
      <div className="grid grid-cols-2 gap-2 md:flex md:justify-end">
        <ReviewForm
          intent="reject"
          fields={{ receivedId: received.id, ownId: own.id }}
          className="grid"
        >
          <ReviewSubmit
            className={SMALL_BUTTON}
            label={`Não é o mesmo: ${received.description} e ${own.description}`}
          >
            Não é o mesmo
          </ReviewSubmit>
        </ReviewForm>
        {refund ? (
          <ReviewForm
            intent="refund"
            fields={{ receivedId: received.id, ownId: own.id }}
            className="grid"
          >
            <ReviewSubmit className={SMALL_PRIMARY}>Ligar ao original</ReviewSubmit>
          </ReviewForm>
        ) : (
          <Link
            href={`/lancamentos/recebidos/par/${received.id}?com=${own.id}`}
            className={SMALL_PRIMARY}
            scroll={false}
          >
            Confirmar par
          </Link>
        )}
      </div>
    </article>
  );
}
