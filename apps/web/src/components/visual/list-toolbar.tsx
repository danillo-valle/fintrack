"use client";

import { useId, useState } from "react";
import { SlidersHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";

// A barra acima de uma lista (M07.3): chips de filtro rápido, a barra de ações e o botão que abre
// o painel de filtros. No celular, as ações entram no painel junto com os filtros (um botão só,
// "Filtros e mais ações"), para os chips caberem.
//
//   computador   [chips ........ ] [ações] [Filtros]      celular   [chips ......] [⚙]
//                [linha extra (opcional)]                          [linha extra   ] (o ⚙ vai aqui)
//                [painel, quando aberto]                           [painel: ações + filtros]
//
// O painel empurra a lista para baixo (não flutua por cima dela). Esc fecha e devolve o foco.
export function ListToolbar({
  chipsLabel,
  chips,
  extraLabel,
  extra,
  actions,
  panel,
  activeCount = 0,
  className,
}: {
  /** Nome da navegação dos chips principais, por exemplo "Período" */
  chipsLabel: string;
  /** A primeira linha: os chips principais */
  chips: React.ReactNode;
  extraLabel?: string;
  /** Uma segunda linha de chips (opcional) */
  extra?: React.ReactNode;
  /** A barra de ações: à direita no computador, dentro do painel no celular */
  actions?: React.ReactNode;
  /** O formulário de filtros */
  panel: React.ReactNode;
  /** Quantos filtros estão ativos (aparece no botão) */
  activeCount?: number;
  className?: string;
}) {
  const panelId = useId();
  const [open, setOpen] = useState(false);
  const badge =
    activeCount > 0 ? (
      <span className="bg-primary text-primary-foreground grid min-w-5 place-items-center rounded-full px-1.5 text-xs font-bold">
        {activeCount}
      </span>
    ) : null;
  const toggle = (
    <FilterButton
      open={open}
      panelId={panelId}
      onClick={() => setOpen((value) => !value)}
      badge={badge}
    />
  );

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <div className="flex items-center gap-3">
        <ScrollRow label={chipsLabel}>{chips}</ScrollRow>
        {actions ? <div className="hidden md:block">{actions}</div> : null}
        <div className={cn(extra ? "hidden md:block" : undefined)}>{toggle}</div>
      </div>
      {extra ? (
        <div className="flex items-center gap-3">
          <ScrollRow label={extraLabel ?? ""}>{extra}</ScrollRow>
          <div className="md:hidden">{toggle}</div>
        </div>
      ) : null}
      <div
        id={panelId}
        role="region"
        aria-label="Filtros"
        hidden={!open}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            setOpen(false);
            // Há um botão por layout (computador e celular): volta para o que está à vista
            const buttons = document.querySelectorAll<HTMLButtonElement>(
              `[aria-controls="${CSS.escape(panelId)}"]`,
            );
            [...buttons].find((b) => b.offsetParent !== null)?.focus();
          }
        }}
        className="bg-card rounded-[1.125rem] border p-4 md:p-5"
      >
        {actions ? <div className="mb-4 overflow-x-auto md:hidden">{actions}</div> : null}
        {panel}
      </div>
    </div>
  );
}

/** Os chips rolam para o lado no celular; no computador, quebram linha. */
function ScrollRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <nav
      aria-label={label}
      className="-mx-4 flex min-w-0 flex-1 [scrollbar-width:none] gap-2 overflow-x-auto px-4 py-0.5 md:mx-0 md:flex-wrap md:overflow-visible md:px-0"
    >
      {children}
    </nav>
  );
}

function FilterButton({
  open,
  panelId,
  onClick,
  badge,
}: {
  open: boolean;
  panelId: string;
  onClick: () => void;
  badge: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-expanded={open}
      aria-controls={panelId}
      onClick={onClick}
      className={cn(
        "bg-card text-foreground hover:bg-muted focus-visible:ring-ring flex h-11 shrink-0 cursor-pointer items-center gap-2 rounded-xl border px-3 text-sm font-semibold outline-none focus-visible:ring-3 md:px-3.5",
        open && "border-primary",
      )}
    >
      <SlidersHorizontal aria-hidden className="size-[1.125rem]" />
      {/* No celular o botão também abre as ações: o nome diz isso ao leitor de tela */}
      <span className="sr-only md:not-sr-only">Filtros</span>
      <span className="sr-only md:hidden"> e mais ações</span>
      {badge}
    </button>
  );
}
