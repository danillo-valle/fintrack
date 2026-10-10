import Link from "next/link";
import { cn } from "@/lib/utils";

export type TabItem = { href: string; label: string; shortLabel?: string; active: boolean };

// Abas de uma seção (M08, canvas D): "Orçamento do mês | Fluxo de caixa | Evolução". Cada aba é
// uma página (link com aria-current="page"), não um painel escondido: dá para voltar e
// compartilhar. Sublinhado azul na escolhida; no celular, rótulos curtos e largura dividida.
export function TabNav({
  label,
  items,
  className,
}: {
  label: string;
  items: TabItem[];
  className?: string;
}) {
  return (
    <nav aria-label={label} className={cn("flex gap-6 border-b", className)}>
      {items.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          aria-current={item.active ? "page" : undefined}
          className={cn(
            "focus-visible:ring-ring -mb-px flex h-11 flex-1 items-center justify-center border-b-[3px] px-1 text-[0.9375rem] whitespace-nowrap outline-none focus-visible:ring-3 focus-visible:ring-inset md:flex-none md:justify-start",
            item.active
              ? "border-chart-1 text-foreground font-bold"
              : "text-muted-foreground hover:text-foreground border-transparent font-semibold",
          )}
        >
          {item.shortLabel ? (
            <>
              <span className="md:hidden">{item.shortLabel}</span>
              <span className="hidden md:inline">{item.label}</span>
            </>
          ) : (
            item.label
          )}
        </Link>
      ))}
    </nav>
  );
}
