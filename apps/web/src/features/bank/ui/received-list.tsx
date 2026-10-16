// As compras recebidas do banco, com a categoria em um clique (M09.1; pranchas E-Cartao e
// E-CelCartao). Usada na página do cartão e na lista de Lançamentos com ?situacao=recebidos.
//
//   computador  data | descrição [3/6] · Recebido · US$ 48,61 · IOF na fatura | categoria | valor
//   celular     descrição [3/6] ............................................. valor
//               data · US$ 48,61 · IOF na fatura
//               [ categoria (largura toda) ]
import { CircleDashed, Globe } from "lucide-react";
import type { CategorizationSource } from "@fintrack/core";
import { AmountText } from "@/components/money/amount-text";
import { ToneChip } from "@/components/visual/tone-chip";
import { formatBRL } from "@/lib/money";
import { CategoryPicker, type CategoryChoice } from "./category-picker";

export type ReceivedRowData = {
  id: string;
  occurredOn: string;
  description: string;
  amount: bigint;
  status: "PENDING" | "SCHEDULED" | "CONFIRMED";
  category: { id: string; name: string; parent: string | null } | null;
  categorizedBy: CategorizationSource | null;
  /** A confiança da camada que sugeriu (M10.1) */
  categorizationConfidence?: number | null;
  installment: { number: number; count: number } | null;
  original: { amount: bigint; currency: string } | null;
  /** Uma frase pequena: "no ambiente Caio" (a compra do adicional), por exemplo */
  note?: string | null;
  canEdit: boolean;
};

const dayMonth = (date: string) => `${date.slice(8, 10)}/${date.slice(5, 7)}`;

/** "US$ 48,61" sem passar por number: os centavos com a moeda na frente. */
function originalLabel(original: { amount: bigint; currency: string }) {
  const symbol =
    original.currency === "USD" ? "US$" : original.currency === "EUR" ? "€" : original.currency;
  return `${symbol} ${formatBRL(original.amount).replace(/^R\$\s?/, "")}`;
}

export function ReceivedList({
  items,
  choices,
  label,
}: {
  items: readonly ReceivedRowData[];
  choices: { expense: readonly CategoryChoice[]; income: readonly CategoryChoice[] };
  label: string;
}) {
  return (
    <ul aria-label={label} className="divide-y">
      {items.map((item) => (
        <li
          key={item.id}
          className="relative grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1.5 py-2.5 md:grid-cols-[3.25rem_minmax(0,1fr)_13rem_7rem] md:items-center md:gap-y-0"
        >
          <span className="text-muted-foreground tabular hidden font-mono text-[0.8125rem] md:block">
            {dayMonth(item.occurredOn)}
          </span>
          <span className="flex min-w-0 flex-col gap-1">
            <span className="flex min-w-0 items-center gap-2">
              <span className="truncate text-[0.9375rem] font-semibold">{item.description}</span>
              {item.installment ? (
                <span className="bg-muted tabular shrink-0 rounded-full px-2 py-0.5 font-mono text-xs font-bold">
                  <span className="sr-only">parcela </span>
                  {item.installment.number}/{item.installment.count}
                </span>
              ) : null}
            </span>
            <span className="text-muted-foreground flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
              <span className="tabular font-mono md:hidden">{dayMonth(item.occurredOn)}</span>
              {item.status === "PENDING" ? (
                <ToneChip tone={4} icon={CircleDashed}>
                  Recebido
                </ToneChip>
              ) : null}
              {item.original ? (
                <span className="inline-flex items-center gap-1">
                  <Globe aria-hidden className="size-3.5" />
                  {originalLabel(item.original)} · IOF na fatura
                </span>
              ) : null}
              {item.note ? <span>{item.note}</span> : null}
            </span>
          </span>
          <AmountText
            cents={item.amount}
            tone="inherit"
            arrow={false}
            className="col-start-2 row-start-1 justify-self-end text-[0.9375rem] font-bold md:col-start-4"
          />
          <span className="col-span-2 min-w-0 md:col-span-1 md:col-start-3 md:row-start-1">
            {item.canEdit ? (
              <CategoryPicker
                item={item}
                choices={item.amount < 0n ? choices.expense : choices.income}
                full
              />
            ) : (
              <span className="text-muted-foreground text-sm">
                {item.category?.name ?? "Sem categoria"}
              </span>
            )}
          </span>
        </li>
      ))}
    </ul>
  );
}
