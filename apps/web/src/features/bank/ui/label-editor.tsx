"use client";

// "O que foi" ao lado da categoria (M13.2, prancha M-Revisao e M-CelRevisao): o nome que a pessoa
// dá a um lançamento do banco ("Sapato da Zara" para "MERCADOLIVRE*MERCA03/03").
//
//   sem nome   [✎ O que foi]                 botão tracejado, do mesmo jeito do "Escolher categoria"
//   com nome   [✎ Sapato da Zara]             o nome, que abre a troca
//
// Abre no lugar, como a categoria: <details>/<summary> com um <form> de Server Action direta (abre
// e grava antes do JavaScript carregar). Numa parcela, o aviso diz que vale para todas.
import { useEffect, useId, useRef } from "react";
import { PencilLine, X } from "lucide-react";
import { ActionForm } from "@/components/feedback/action-form";
import { cn } from "@/lib/utils";
import { setLabelAction } from "../server/actions";

export function LabelEditor({
  item,
  full = false,
}: {
  item: {
    id: string;
    description: string;
    label: string | null;
    installment: { number: number; count: number } | null;
  };
  full?: boolean;
}) {
  const ref = useRef<HTMLDetailsElement>(null);
  const summaryRef = useRef<HTMLElement>(null);
  const panelId = useId();
  const titleId = useId();
  const inputId = useId();
  const helpId = useId();

  const close = () => {
    const details = ref.current;
    if (!details?.open) return;
    details.open = false;
    summaryRef.current?.focus();
  };

  return (
    <details
      ref={ref}
      onToggle={() => {
        if (ref.current?.open)
          ref.current.querySelector<HTMLInputElement>("input[name=label]")?.focus();
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          close();
        }
      }}
      className={cn("relative", full ? "w-full" : "min-w-0")}
    >
      <summary
        ref={summaryRef}
        aria-controls={panelId}
        className={cn(
          "focus-visible:ring-ring flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-xl px-3 text-sm font-bold outline-none focus-visible:ring-3 [&::-webkit-details-marker]:hidden",
          item.label
            ? "bg-card hover:bg-muted border"
            : "border-chart-1-ink text-chart-1-ink justify-center border-[1.5px] border-dashed bg-[color-mix(in_srgb,var(--chart-1)_14%,transparent)]",
          full && "w-full",
        )}
      >
        <PencilLine aria-hidden className="size-4 shrink-0" />
        <span className="truncate">{item.label ?? "O que foi"}</span>
        <span className="sr-only">
          {item.label ? ", trocar o que foi de " : " de "}
          {item.description}
        </span>
      </summary>

      <div aria-hidden onClick={close} className="bg-scrim fixed inset-0 z-[60] md:hidden" />
      <div
        id={panelId}
        role="dialog"
        aria-labelledby={titleId}
        className={cn(
          "bg-card text-card-foreground z-[61] flex flex-col gap-2.5 border shadow-[0_18px_50px_rgb(4_6_20/0.3)]",
          "fixed inset-x-0 bottom-0 rounded-t-3xl px-4 pt-3 pb-7",
          "md:absolute md:inset-x-auto md:top-[calc(100%-2px)] md:right-0 md:bottom-auto md:w-[21rem] md:rounded-[1.125rem] md:p-3.5",
        )}
      >
        <span aria-hidden className="bg-border mx-auto h-1.5 w-10 rounded-full md:hidden" />
        <div className="flex items-start justify-between gap-2">
          <h3 id={titleId} className="min-w-0 text-base font-bold md:text-[0.9375rem]">
            O que foi{" "}
            <span className="text-muted-foreground font-semibold">{item.description}</span>
          </h3>
          <button
            type="button"
            onClick={close}
            aria-label="Fechar"
            className="hover:bg-muted focus-visible:ring-ring -my-2 -mr-2 grid size-11 shrink-0 place-items-center rounded-xl outline-none focus-visible:ring-3"
          >
            <X aria-hidden className="size-5" />
          </button>
        </div>
        <ActionForm action={setLabelAction} aria-label={`O que foi: ${item.description}`}>
          {({ pending, state }) => (
            <LabelBody
              item={item}
              pending={pending}
              saved={Boolean(state.success)}
              onSaved={close}
              inputId={inputId}
              helpId={helpId}
            />
          )}
        </ActionForm>
      </div>
    </details>
  );
}

function LabelBody({
  item,
  pending,
  saved,
  onSaved,
  inputId,
  helpId,
}: {
  item: { id: string; label: string | null; installment: { count: number } | null };
  pending: boolean;
  saved: boolean;
  onSaved: () => void;
  inputId: string;
  helpId: string;
}) {
  // Gravou: fecha e devolve o foco à linha (a página volta do servidor com o nome)
  useEffect(() => {
    if (saved) onSaved();
  }, [saved, onSaved]);

  return (
    <div className="flex flex-col gap-2.5">
      <input type="hidden" name="transactionId" value={item.id} />
      <label htmlFor={inputId} className="text-sm font-bold">
        O que foi
      </label>
      <input
        id={inputId}
        name="label"
        defaultValue={item.label ?? ""}
        maxLength={200}
        autoComplete="off"
        placeholder="Ex.: Sapato da Zara"
        aria-describedby={helpId}
        className="bg-background focus-visible:ring-ring h-11 w-full rounded-xl border px-3 text-[0.9375rem] outline-none focus-visible:ring-3"
      />
      <span id={helpId} className="text-muted-foreground text-xs">
        {item.installment ? `Vale para as ${item.installment.count} parcelas desta compra. ` : ""}O
        texto do banco fica guardado. Em branco, volta a aparecer só o do banco.
      </span>
      <div className="flex justify-end gap-2">
        <button
          type="submit"
          disabled={pending}
          className="bg-primary text-primary-foreground focus-visible:ring-ring h-11 rounded-xl px-5 text-sm font-bold outline-none focus-visible:ring-3 disabled:opacity-60"
        >
          {pending ? "Salvando…" : "Salvar"}
        </button>
      </div>
    </div>
  );
}
