"use client";

import { useActionState, useEffect, useRef, useTransition } from "react";
import Link from "next/link";
import { Copy, PencilLine } from "lucide-react";
import { toast } from "sonner";
import { undoToast } from "@/components/feedback/undo-toast";
import { ACTION_BAR_ITEM } from "@/components/visual/action-bar";
import { INITIAL_ACTION_STATE } from "@/lib/action-state";
import { cn } from "@/lib/utils";
import { copyBudgetsAction, undoCopyBudgetsAction, type CopyState } from "../server/actions";

// As ações do Orçamento do mês (M08, canvas D): "Copiar de setembro" e "Editar valores".
// No computador ficam numa barra só, à direita do ambiente; no celular, dois botões lado a lado
// embaixo do destaque. A cópia só preenche o que falta no mês e mostra o aviso com "Desfazer";
// sem nada a copiar, o aviso diz isso.

const INITIAL: CopyState = { ...INITIAL_ACTION_STATE, copied: null };

/** O item da barra e, no celular, um botão solto com borda (como no canvas). */
const ITEM = cn(
  ACTION_BAR_ITEM,
  "max-md:bg-card max-md:justify-center max-md:rounded-xl max-md:border max-md:h-11",
);

export function BudgetActions({
  walletId,
  month,
  previousTitle,
  editHref,
  className,
}: {
  /** O ambiente da cópia (só um ambiente por vez; em "Tudo que vejo" não há cópia) */
  walletId: string | null;
  month: string;
  /** "setembro" */
  previousTitle: string;
  editHref: string | null;
  className?: string;
}) {
  if (!editHref && !walletId) return null;
  return (
    <nav
      aria-label="Ações do orçamento"
      className={cn(
        "md:bg-card grid grid-cols-2 gap-2.5 md:flex md:w-fit md:gap-0 md:divide-x md:overflow-hidden md:rounded-xl md:border",
        className,
      )}
    >
      {walletId ? (
        <CopyButton walletId={walletId} month={month} previousTitle={previousTitle} />
      ) : null}
      {editHref ? (
        <Link
          href={editHref}
          style={{ "--tone": "var(--chart-4)" } as React.CSSProperties}
          className={ITEM}
        >
          <PencilLine aria-hidden className="size-[1.125rem] shrink-0 text-[var(--tone)]" />
          Editar valores
        </Link>
      ) : null}
    </nav>
  );
}

function CopyButton({
  walletId,
  month,
  previousTitle,
}: {
  walletId: string;
  month: string;
  previousTitle: string;
}) {
  const [state, formAction, pending] = useActionState(copyBudgetsAction, INITIAL);
  const [, startUndo] = useTransition();
  const shown = useRef<CopyState>(INITIAL);

  // Cada resposta do servidor é um objeto novo: mostra o aviso uma vez por resposta
  useEffect(() => {
    if (state === shown.current) return;
    shown.current = state;
    if (state.error) {
      toast.error(state.error);
      return;
    }
    if (!state.success) return;
    const copied = state.copied;
    if (!copied) {
      toast(state.success);
      return;
    }
    undoToast(state.success, {
      variant: "success",
      onUndo: () =>
        startUndo(async () => {
          const form = new FormData();
          form.set("walletId", copied.walletId);
          form.set("month", copied.month);
          form.set("categoryIds", copied.categoryIds.join(","));
          form.set("copiedAt", copied.copiedAt);
          const result = await undoCopyBudgetsAction(INITIAL_ACTION_STATE, form);
          if (result.error) toast.error(result.error);
          else if (result.success) toast(result.success);
        }),
    });
  }, [state]);

  return (
    <form action={formAction} className="contents">
      <input type="hidden" name="walletId" value={walletId} />
      <input type="hidden" name="month" value={month} />
      <button
        type="submit"
        // Sempre clicável (botão desabilitado some do teclado e não diz por quê): sem nada a
        // copiar, o aviso explica
        disabled={pending}
        style={{ "--tone": "var(--chart-1)" } as React.CSSProperties}
        className={ITEM}
      >
        <Copy aria-hidden className="size-[1.125rem] shrink-0 text-[var(--tone)]" />
        {pending ? "Copiando…" : `Copiar de ${previousTitle}`}
      </button>
    </form>
  );
}
