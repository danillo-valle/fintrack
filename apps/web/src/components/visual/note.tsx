import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

// Nota de apoio (M09.3, linha E.3 do canvas): um ícone na tinta do tom e o texto, num painel
// discreto ("Como exportar…", "Só os 4 últimos dígitos…"). Não é aviso: avisos usam role
// "status" ou "alert"; a nota é texto comum, lido na ordem da página.
export function Note({
  icon: Icon,
  tone = 1,
  children,
  className,
}: {
  icon: LucideIcon;
  tone?: 1 | 2 | 3 | 4 | 5;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      style={{ "--ink": `var(--chart-${tone}-ink)` } as React.CSSProperties}
      className={cn(
        "bg-muted/60 grid grid-cols-[1.375rem_minmax(0,1fr)] gap-2.5 rounded-[0.875rem] border px-3.5 py-3 text-sm",
        className,
      )}
    >
      <Icon aria-hidden className="size-5 text-[var(--ink)]" />
      <p>{children}</p>
    </div>
  );
}
