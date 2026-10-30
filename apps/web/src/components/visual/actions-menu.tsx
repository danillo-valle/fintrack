"use client";

// O menu "⋯" de uma linha (M13.1, prancha L-Contas): as ações de um cartão ou de uma conta
// (Editar, Compras conjuntas, Arquivar) atrás de um botão, em vez de soltas na linha.
//
// É um botão que mostra e esconde uma lista (aria-expanded), sem biblioteca. Cada ação é um
// formulário de Server Action (ActionButton), e o aviso do resultado (o verde ou o vermelho) nasce
// dentro do formulário: por isso a lista fica SEMPRE montada (só escondida com `hidden`) e continua
// aberta depois do envio, com o aviso à vista de quem tocou. Fecha com Esc (o foco volta ao botão)
// e com clique fora. Sem role="menu": é uma lista de botões e links comuns, que o Tab percorre na
// ordem, como qualquer outro formulário.
import { MoreHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";
import { usePopover } from "./use-popover";

export function ActionsMenu({
  label,
  children,
  align = "end",
  className,
}: {
  /** Nome acessível do botão: "Opções do cartão Master da casa" */
  label: string;
  children: React.ReactNode;
  align?: "start" | "end";
  className?: string;
}) {
  const { open, toggle, panelId, rootRef, triggerRef } = usePopover();

  return (
    <div ref={rootRef} className={cn("relative shrink-0", className)}>
      <button
        ref={triggerRef}
        type="button"
        aria-label={label}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={toggle}
        className="border-border bg-card hover:bg-muted aria-expanded:bg-muted focus-visible:ring-ring inline-flex size-10 items-center justify-center rounded-xl border outline-none focus-visible:ring-3"
      >
        <MoreHorizontal aria-hidden className="size-[1.125rem]" />
      </button>
      <div
        id={panelId}
        hidden={!open}
        className={cn(
          "bg-card absolute top-12 z-30 flex w-max max-w-[min(18rem,calc(100vw-2rem))] min-w-[15rem] flex-col gap-0.5 rounded-2xl border p-1.5 shadow-[0_18px_40px_rgba(10,13,40,0.22)]",
          align === "end" ? "right-0" : "left-0",
        )}
      >
        {children}
      </div>
    </div>
  );
}

/** A classe de cada item do menu: largo, alto o bastante para o dedo (44 px), alinhado à esquerda. */
export const MENU_ITEM =
  "hover:bg-muted focus-visible:ring-ring flex h-11 w-full items-center justify-start gap-2.5 rounded-xl px-3 text-left text-[0.9375rem] font-semibold outline-none focus-visible:ring-3 [&_svg]:size-[1.125rem] [&_svg]:shrink-0";

/** Uma linha fina entre grupos de itens. */
export function MenuSeparator() {
  return <span aria-hidden className="bg-border mx-1.5 my-1 h-px" />;
}
