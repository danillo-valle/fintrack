"use client";

// O combo de marcar (M13.3a, prancha N-Cabecalho): uma pílula com o nome do filtro e o valor de
// agora ("Período · 3 meses", "Pago por · Lia, Compartilhado") que abre um painel com caixas de
// marcar e o "Aplicar". O painel é um formulário GET comum (quem usa monta), então o filtro vai
// para a URL, como os outros. Abre e fecha como o menu "⋯" (usePopover): Esc devolve o foco à
// pílula, clique fora fecha. No celular o painel sobe da base da tela, por cima da barra, com a
// largura toda (preso embaixo da pílula, ele saía da tela quando a pílula estava mais abaixo).
//
// Os atalhos do painel são links da mesma tela: a navegação do Next mantém o combo montado, então
// o clique num atalho fecha o painel (com o foco de volta na pílula) e o conteúdo do painel nasce de
// novo a cada `selection`, para as caixas mostrarem o que a URL nova marcou.
import { Fragment, useEffect, useRef } from "react";
import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { usePopover } from "./use-popover";

export function CheckCombo({
  label,
  value,
  count,
  selection,
  children,
  className,
}: {
  /** O nome do filtro: "Período", "Pago por" */
  label: string;
  /** O que está marcado agora, curto: "3 meses", "Todos" */
  value: string;
  /** Quantos estão marcados (o número no celular, onde o valor não cabe) */
  count?: number;
  /** O que a URL marcou, inteiro (os meses, as pessoas): muda, o painel nasce de novo */
  selection: string;
  /** O formulário com as caixas de marcar e o Aplicar */
  children: React.ReactNode;
  className?: string;
}) {
  const { open, toggle, close, panelId, rootRef, triggerRef } = usePopover();
  const panelRef = useRef<HTMLDivElement>(null);

  // Um atalho (link) do painel fecha o painel; o Enter num link também dispara o clique
  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const onClick = (event: MouseEvent) => {
      if (event.target instanceof Element && event.target.closest("a[href]")) close();
    };
    panel.addEventListener("click", onClick);
    return () => panel.removeEventListener("click", onClick);
  }, [close]);

  return (
    <div ref={rootRef} className={cn("relative", className)}>
      <button
        ref={triggerRef}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={toggle}
        className="bg-card hover:bg-muted aria-expanded:border-primary focus-visible:ring-ring flex h-11 max-w-full items-center gap-2 rounded-full border pr-3 pl-4 text-sm outline-none focus-visible:ring-3"
      >
        <span className="text-muted-foreground font-medium">{label}</span>
        <span className="truncate font-bold">{value}</span>
        {count !== undefined && count > 1 ? (
          <span className="bg-primary text-primary-foreground grid min-w-5 place-items-center rounded-full px-1.5 text-xs font-bold md:hidden">
            {count}
          </span>
        ) : null}
        <ChevronDown aria-hidden className="size-4 shrink-0" />
      </button>
      <div
        ref={panelRef}
        id={panelId}
        role="region"
        aria-label={label}
        hidden={!open}
        className="bg-card fixed inset-x-0 bottom-0 z-50 max-h-[80dvh] overflow-y-auto rounded-t-2xl border p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] shadow-[0_-12px_40px_rgba(10,13,40,0.22)] md:absolute md:inset-x-auto md:bottom-auto md:left-0 md:z-30 md:mt-2 md:w-80 md:rounded-2xl md:pb-3 md:shadow-[0_18px_40px_rgba(10,13,40,0.22)]"
      >
        <Fragment key={selection}>{children}</Fragment>
      </div>
    </div>
  );
}

/** Uma linha de caixa de marcar do combo: alvo de 44 px, o texto do lado. */
export function CheckRow({
  name,
  value,
  checked,
  children,
}: {
  name: string;
  value: string;
  checked: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="hover:bg-muted has-focus-visible:ring-ring flex min-h-11 cursor-pointer items-center gap-3 rounded-xl px-2.5 has-focus-visible:ring-3">
      <input
        type="checkbox"
        name={name}
        value={value}
        defaultChecked={checked}
        className="accent-primary size-[1.125rem] shrink-0 outline-none"
      />
      <span className="flex min-w-0 flex-1 items-center gap-2.5 text-[0.9375rem]">{children}</span>
    </label>
  );
}

/**
 * O rodapé do formulário do combo, com o Aplicar. Fica preso embaixo do painel: no celular a lista
 * de meses é mais alta que a tela, e o Aplicar continua à vista enquanto ela rola.
 */
export function CheckComboFooter() {
  return (
    <div className="bg-card sticky -bottom-3 -mx-3 -mb-3 flex items-center justify-end border-t px-3 pt-2 pb-3">
      <Button type="submit">Aplicar</Button>
    </div>
  );
}
