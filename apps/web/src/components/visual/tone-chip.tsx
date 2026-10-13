import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

// Etiqueta de situação (M09.1, linha E do canvas): "Recebido", "7 a revisar", "Paga". O texto na
// tinta do tom (--chart-N-ink) sobre o próprio tom a 14 %: o par conferido no
// theme-contrast.test.ts. O texto sempre diz a situação; a cor e o ícone só reforçam.
export function ToneChip({
  tone,
  icon: Icon,
  children,
  className,
}: {
  tone: 1 | 2 | 3 | 4 | 5;
  icon?: LucideIcon;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      style={
        {
          "--tone": `var(--chart-${tone})`,
          "--ink": `var(--chart-${tone}-ink)`,
        } as React.CSSProperties
      }
      className={cn(
        "inline-flex h-6 shrink-0 items-center gap-1.5 rounded-full bg-[color-mix(in_srgb,var(--tone)_14%,transparent)] px-2.5 text-xs font-bold whitespace-nowrap text-[var(--ink)]",
        className,
      )}
    >
      {Icon ? <Icon aria-hidden className="size-3.5" /> : null}
      {children}
    </span>
  );
}
