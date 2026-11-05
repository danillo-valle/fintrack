// As compras recebidas do banco, com a categoria em um clique (M09.1; pranchas E-Cartao e
// E-CelCartao). Usada na página do cartão e na lista de Lançamentos com ?situacao=recebidos.
//
//   lista larga  data | descrição [3/6] · Recebido · US$ 48,61 · IOF na fatura | categoria · O que foi | valor
//   estreita     descrição [3/6] ............................................. valor
//                data · US$ 48,61 · IOF na fatura
//                [ categoria ] [ O que foi ]
//
// M13.2: o "O que foi" ao lado da categoria (o nome da pessoa em destaque, o texto do banco embaixo).
// A linha vira colunas pela largura da LISTA (contêiner, @3xl = 48rem), não da tela: na página do
// cartão a lista divide a tela com a fatura, e as colunas não cabiam (o texto entrava na vizinha).
import { CircleDashed, Globe } from "lucide-react";
import type { CategorizationSource, NatureView } from "@fintrack/core";
import { AmountText } from "@/components/money/amount-text";
import { ToneChip } from "@/components/visual/tone-chip";
import { formatBRL } from "@/lib/money";
import { NatureTag } from "@/features/transactions/ui/nature/nature-tag";
import { CategoryPicker, type CategoryChoice } from "./category-picker";
import { LabelEditor } from "./label-editor";
import { civilDayMonth } from "@/lib/dates";

export type ReceivedRowData = {
  id: string;
  occurredOn: string;
  description: string;
  /** "O que foi" (M13.2): o nome que a pessoa deu a este lançamento do banco */
  label: string | null;
  amount: bigint;
  status: "PENDING" | "SCHEDULED" | "CONFIRMED";
  category: { id: string; name: string; parent: string | null } | null;
  categorizedBy: CategorizationSource | null;
  /** A confiança da camada que sugeriu (M10.1) */
  categorizationConfidence?: number | null;
  installment: { number: number; count: number } | null;
  /** O tipo da saída (M13.3b): no botão da categoria e no painel dela */
  natureView: NatureView | null;
  original: { amount: bigint; currency: string } | null;
  /** Uma frase pequena: "no ambiente Caio" (a compra do adicional), por exemplo */
  note?: string | null;
  canEdit: boolean;
};

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
    <ul aria-label={label} className="@container divide-y">
      {items.map((item) => (
        <li
          key={item.id}
          className="relative grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1.5 py-2.5 @3xl:grid-cols-[3.25rem_minmax(0,1fr)_minmax(0,22rem)_7rem] @3xl:items-center @3xl:gap-y-0"
        >
          <span className="text-muted-foreground tabular hidden font-mono text-[0.8125rem] @3xl:block">
            {civilDayMonth(item.occurredOn)}
          </span>
          <span className="flex min-w-0 flex-col gap-1">
            <span className="flex min-w-0 items-center gap-2">
              <span className="flex min-w-0 flex-col">
                <span className="truncate text-[0.9375rem] font-semibold">
                  {item.label ?? item.description}
                </span>
                {item.label ? (
                  <span className="text-muted-foreground tabular truncate font-mono text-xs">
                    {item.description}
                  </span>
                ) : null}
              </span>
              {item.installment ? (
                <span className="bg-muted tabular shrink-0 rounded-full px-2 py-0.5 font-mono text-xs font-bold">
                  <span className="sr-only">parcela </span>
                  {item.installment.number}/{item.installment.count}
                </span>
              ) : null}
            </span>
            <span className="text-muted-foreground flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
              <span className="tabular font-mono @3xl:hidden">
                {civilDayMonth(item.occurredOn)}
              </span>
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
            className="col-start-2 row-start-1 justify-self-end text-[0.9375rem] font-bold @3xl:col-start-4"
          />
          <span className="col-span-2 flex min-w-0 gap-1.5 @3xl:col-span-1 @3xl:col-start-3 @3xl:row-start-1">
            {item.canEdit ? (
              <>
                <span className="min-w-0 flex-1">
                  <CategoryPicker
                    item={item}
                    choices={item.amount < 0n ? choices.expense : choices.income}
                    others={
                      item.amount < 0n
                        ? { kind: "receita", choices: choices.income }
                        : { kind: "despesa", choices: choices.expense }
                    }
                    offerTransfer={item.status === "PENDING"}
                    full
                  />
                </span>
                <span className="min-w-0 flex-1">
                  <LabelEditor item={item} full />
                </span>
              </>
            ) : (
              <span className="text-muted-foreground flex items-center gap-1.5 text-sm">
                {item.category?.name ?? "Sem categoria"}
                {item.natureView ? <NatureTag kind={item.natureView.kind} size="sm" /> : null}
              </span>
            )}
          </span>
        </li>
      ))}
    </ul>
  );
}
