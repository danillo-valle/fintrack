"use client";

// O topo de uma lista (M13.3a, prancha N-Cabecalho): o título do período, uma linha de apoio e,
// no canto direito, o Filtros (que abre o painel embaixo, empurrando a lista) e as ações da lista
// (o CSV). Esc fecha o painel e devolve o foco ao botão.
import { useId, useRef, useState } from "react";
import { SlidersHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";

export function ListHeader({
  id,
  title,
  subtitle,
  actions,
  panel,
  activeCount = 0,
  className,
}: {
  /** O id do título (a lista se apresenta por ele) */
  id: string;
  title: string;
  subtitle?: React.ReactNode;
  /** As ações da lista, à direita do Filtros (o CSV) */
  actions?: React.ReactNode;
  /** O formulário de filtros */
  panel: React.ReactNode;
  activeCount?: number;
  className?: string;
}) {
  const panelId = useId();
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <div className="flex flex-wrap items-end justify-between gap-3 px-1">
        <div className="min-w-0">
          <h2 id={id} className="text-xl font-extrabold tracking-[-0.01em]">
            {title}
          </h2>
          {subtitle ? <p className="text-muted-foreground text-sm">{subtitle}</p> : null}
        </div>
        <div className="flex items-center gap-2">
          <button
            ref={buttonRef}
            type="button"
            aria-expanded={open}
            aria-controls={panelId}
            onClick={() => setOpen((v) => !v)}
            className={cn(
              "bg-card text-foreground hover:bg-muted focus-visible:ring-ring flex h-11 shrink-0 cursor-pointer items-center gap-2 rounded-xl border px-3.5 text-sm font-bold outline-none focus-visible:ring-3",
              open && "border-primary",
            )}
          >
            <SlidersHorizontal aria-hidden className="size-[1.125rem]" />
            Filtros
            {activeCount > 0 ? (
              <span className="bg-primary text-primary-foreground grid min-w-5 place-items-center rounded-full px-1.5 text-xs font-bold">
                {activeCount}
              </span>
            ) : null}
          </button>
          {actions}
        </div>
      </div>
      <div
        id={panelId}
        role="region"
        aria-label="Filtros"
        hidden={!open}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            setOpen(false);
            buttonRef.current?.focus();
          }
        }}
        className="bg-card rounded-[1.125rem] border p-4 md:p-5"
      >
        {panel}
      </div>
    </div>
  );
}
