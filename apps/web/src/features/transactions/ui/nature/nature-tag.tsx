import { Layers, Repeat, Waves, type LucideIcon } from "lucide-react";
import type { SpendingNature } from "@fintrack/core";
import { SPENDING_NATURE_LABEL } from "@/lib/labels";
import { cn } from "@/lib/utils";

// A etiqueta do tipo da despesa (M13.3b, ADR-026, canvas N-FixaVariavel): Fixa, Variável ou
// Parcela. O texto sempre diz o tipo; o ícone e a cor só reforçam (a fixa no tom 4, as outras no
// neutro). `size="sm"` é a do botão da categoria, ao lado da etiqueta de quem sugeriu.
export const NATURE_ICON: Record<SpendingNature, LucideIcon> = {
  fixed: Repeat,
  variable: Waves,
  installment: Layers,
};

export function natureTagClass(kind: SpendingNature, size: "sm" | "md" = "md") {
  return cn(
    "inline-flex shrink-0 items-center gap-1 rounded-full font-bold whitespace-nowrap",
    size === "sm" ? "h-5 px-1.5 text-[0.71875rem]" : "h-6 px-2.5 text-xs",
    kind === "fixed"
      ? "bg-[color-mix(in_srgb,var(--chart-4)_14%,transparent)] text-chart-4-ink"
      : "bg-muted text-muted-foreground",
  );
}

/** A etiqueta só de leitura (a parcela, ou quem não pode editar). */
export function NatureTag({
  kind,
  size = "md",
  className,
}: {
  kind: SpendingNature;
  size?: "sm" | "md";
  className?: string;
}) {
  const Icon = NATURE_ICON[kind];
  return (
    <span data-slot="nature-tag" className={cn(natureTagClass(kind, size), className)}>
      <Icon aria-hidden className={size === "sm" ? "size-3" : "size-3.5"} />
      {SPENDING_NATURE_LABEL[kind]}
    </span>
  );
}
