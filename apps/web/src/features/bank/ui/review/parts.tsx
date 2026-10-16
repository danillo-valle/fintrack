// Peças pequenas da revisão (M09.2, linha E.2 do canvas): os botões, a categoria com a origem,
// a etiqueta do cartão e as frases. Sem estado: servem às telas do servidor e do navegador.
import { CreditCard } from "lucide-react";
import type { CategorizationSource } from "@fintrack/core";
import { buttonVariants } from "@/components/ui/button";
import { IconTile } from "@/components/visual/icon-tile";
import { SourcePill } from "@/components/visual/source-pill";
import { toneFor } from "@/components/visual/tone";
import { ToneChip } from "@/components/visual/tone-chip";
import { cn } from "@/lib/utils";

/** O botão pequeno das linhas e dos pares (36 px no computador, 44 px no celular). */
export const SMALL_BUTTON = cn(
  buttonVariants({ variant: "outline" }),
  "h-11 rounded-[0.625rem] px-3 text-[0.8125rem] font-semibold md:h-9",
);
export const SMALL_PRIMARY = cn(
  buttonVariants({ variant: "default" }),
  "h-11 rounded-[0.625rem] px-3 text-[0.8125rem] font-bold md:h-9",
);
/** O botão principal (40 px): "Confirmar os 15 que já têm categoria" */
export const MAIN_BUTTON = cn(
  buttonVariants({ variant: "default" }),
  "h-11 gap-2 rounded-xl px-[1.125rem] text-sm font-bold md:h-10",
);

export const dayMonth = (date: string) => `${date.slice(8, 10)}/${date.slice(5, 7)}`;

const MONTHS = [
  "janeiro",
  "fevereiro",
  "março",
  "abril",
  "maio",
  "junho",
  "julho",
  "agosto",
  "setembro",
  "outubro",
  "novembro",
  "dezembro",
];
/** "2026-10" → "outubro" */
export const monthName = (key: string) => MONTHS[Number.parseInt(key.slice(5, 7), 10) - 1] ?? key;

/** [M] Mercado / [⟲ Histórico] (a categoria e quem decidiu, com a confiança, M10.1). */
export function CategoryLabel({
  category,
  categorizedBy,
  confidence = null,
}: {
  category: { id: string; name: string } | null;
  categorizedBy: CategorizationSource | null;
  confidence?: number | null;
}) {
  if (!category) return <span className="text-muted-foreground text-sm">Sem categoria</span>;
  return (
    <span className="inline-flex min-w-0 items-center gap-2">
      <IconTile
        tone={toneFor(category.id)}
        letter={category.name}
        size="sm"
        className="size-7 rounded-lg text-[0.8125rem]"
      />
      <span className="flex min-w-0 flex-col items-start gap-1 leading-tight">
        <span className="truncate text-sm font-semibold">{category.name}</span>
        {categorizedBy ? (
          <SourcePill source={categorizedBy} confidence={confidence} className="h-5" />
        ) : null}
      </span>
    </span>
  );
}

/**
 * A etiqueta do cartão de um recebido: "final 0001 · Lia" (titular), "final 0003 · Caio"
 * (adicional) ou "final 0009 · não cadastrado". O texto diz tudo; a cor só reforça.
 */
export function CardChip({
  card,
  unknownLastFour,
}: {
  card: { lastFour: string; holder: string | null; additional: boolean } | null;
  unknownLastFour: string | null;
}) {
  if (card) {
    return (
      <ToneChip tone={card.additional ? 5 : 1} icon={CreditCard} className="tabular">
        final {card.lastFour}
        {card.holder ? ` · ${card.holder.split(" ")[0]}` : ""}
      </ToneChip>
    );
  }
  if (unknownLastFour) {
    return (
      <ToneChip tone={4} icon={CreditCard} className="tabular">
        final {unknownLastFour} · não cadastrado
      </ToneChip>
    );
  }
  return null;
}
