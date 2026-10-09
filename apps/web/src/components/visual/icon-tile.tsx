import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/** As cinco cores de gráfico do tema (todas com 3:1 sobre o cartão) e o neutro. */
export type Tone = 1 | 2 | 3 | 4 | 5 | "neutral";

type Props = {
  tone: Tone;
  /** Um ícone OU uma letra (a inicial da categoria, por exemplo) */
  icon?: LucideIcon;
  letter?: string;
  size?: "sm" | "md" | "lg";
  className?: string;
};

const SIZE = {
  sm: "size-9 rounded-xl text-sm",
  md: "size-11 rounded-2xl",
  lg: "size-14 rounded-2xl text-lg",
};
const ICON = { sm: "size-4", md: "size-5", lg: "size-6" };

// Quadrado colorido que identifica uma coisa (categoria, tipo de carteira, seção dos Ajustes).
// É decorativo: o nome da coisa está sempre escrito ao lado, então a cor nunca é o único sinal.
export function IconTile({ tone, icon: Icon, letter, size = "md", className }: Props) {
  const color = tone === "neutral" ? "var(--muted-foreground)" : `var(--chart-${tone})`;
  return (
    <span
      aria-hidden
      style={{ "--tone": color } as React.CSSProperties}
      className={cn(
        "inline-flex shrink-0 items-center justify-center bg-[color-mix(in_srgb,var(--tone)_16%,transparent)] font-semibold text-[var(--tone)]",
        SIZE[size],
        className,
      )}
    >
      {Icon ? <Icon className={ICON[size]} /> : (letter ?? "").slice(0, 1).toUpperCase()}
    </span>
  );
}
