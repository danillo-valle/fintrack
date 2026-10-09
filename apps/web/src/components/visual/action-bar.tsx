import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Tone } from "./icon-tile";

// Barra de ações (M07.3): as ações secundárias de uma página num bloco só, com ícone colorido e
// nome escrito (a cor nunca é o único sinal). Substitui os chips de ação do M07.2, que se
// confundiam com os chips de filtro.
export function ActionBar({
  label,
  children,
  className,
}: {
  /** Nome da navegação para o leitor de tela, por exemplo "Mais ações de lançamento" */
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <nav
      aria-label={label}
      className={cn(
        "bg-card [&>*]:border-border flex w-fit divide-x overflow-hidden rounded-xl border",
        className,
      )}
    >
      {children}
    </nav>
  );
}

export function ActionBarLink({
  href,
  icon: Icon,
  tone,
  children,
}: {
  href: string;
  icon: LucideIcon;
  tone: Exclude<Tone, "neutral">;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      style={{ "--tone": `var(--chart-${tone})` } as React.CSSProperties}
      className="hover:bg-muted focus-visible:ring-ring flex h-[2.625rem] items-center gap-2 px-3.5 text-sm font-semibold whitespace-nowrap outline-none focus-visible:ring-3 focus-visible:ring-inset"
    >
      <Icon aria-hidden className="size-[1.125rem] shrink-0 text-[var(--tone)]" />
      {children}
    </Link>
  );
}
