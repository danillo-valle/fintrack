import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export type SegmentedItem = { href: string; label: string; icon?: LucideIcon; active: boolean };

// Um seletor de "uma coisa entre poucas" feito de links (M07.4): o escolhido em destaque, com
// aria-current. Links, e não botões, porque a escolha vai para a URL (dá para voltar e
// compartilhar). No celular ocupa a largura toda e as opções dividem o espaço.
export function SegmentedNav({
  label,
  items,
  className,
}: {
  /** Nome da navegação para o leitor de tela, por exemplo "Ambiente" */
  label: string;
  items: SegmentedItem[];
  className?: string;
}) {
  return (
    <nav
      aria-label={label}
      className={cn(
        "bg-muted grid w-full auto-cols-fr grid-flow-col gap-0.5 rounded-xl border p-1 md:flex md:w-auto",
        className,
      )}
    >
      {items.map(({ href, label: text, icon: Icon, active }) => (
        <Link
          key={href}
          href={href}
          aria-current={active ? "true" : undefined}
          className={cn(
            "focus-visible:ring-ring flex h-9 min-w-0 items-center justify-center gap-2 rounded-[0.5625rem] px-3.5 text-sm whitespace-nowrap outline-none focus-visible:ring-3",
            active
              ? "bg-card text-foreground font-bold shadow-[0_1px_4px_rgb(10_13_40/0.14)]"
              : "text-muted-foreground hover:text-foreground font-semibold",
          )}
        >
          {Icon ? <Icon aria-hidden className="hidden size-[1.0625rem] shrink-0 md:block" /> : null}
          <span className="truncate">{text}</span>
        </Link>
      ))}
    </nav>
  );
}
