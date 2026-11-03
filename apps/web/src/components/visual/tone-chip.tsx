import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

// Etiqueta de situação (M09.1, linha E do canvas): "Recebido", "7 a revisar", "Paga". O texto na
// tinta do tom (--chart-N-ink) sobre o próprio tom a 14 %: o par conferido no
// theme-contrast.test.ts. O texto sempre diz a situação; a cor e o ícone só reforçam.
//
// `shrink` (M13.2): a etiqueta cabe na coluna dela e corta o fim do texto com reticências (o nome
// inteiro continua no HTML, para o leitor de tela). Sem ele, a etiqueta tem a largura do texto.
export function ToneChip({
  tone,
  icon: Icon,
  children,
  className,
  shrink = false,
}: {
  tone: 1 | 2 | 3 | 4 | 5;
  icon?: LucideIcon;
  children: React.ReactNode;
  className?: string;
  shrink?: boolean;
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
        "inline-flex h-6 items-center gap-1.5 rounded-full bg-[color-mix(in_srgb,var(--tone)_14%,transparent)] px-2.5 text-xs font-bold whitespace-nowrap text-[var(--ink)]",
        shrink ? "max-w-full min-w-0" : "shrink-0",
        className,
      )}
    >
      {Icon ? <Icon aria-hidden className="size-3.5 shrink-0" /> : null}
      {shrink ? <span className="min-w-0 truncate">{children}</span> : children}
    </span>
  );
}
