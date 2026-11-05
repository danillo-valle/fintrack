"use client";

// A etiqueta Fixa/Variável da linha, num toque (M13.3b, ADR-026, canvas N-FixaVariavel "Na lista,
// num toque"). A etiqueta é o botão: abre, no lugar, a escolha do tipo com "as próximas desta loja
// também". Como o CategoryPicker: <details>/<summary> e um <form> com a Server Action direta (abre,
// escolhe e grava antes do JavaScript); o JavaScript só acrescenta o Esc, o "um aberto por vez" e
// devolver o foco à etiqueta depois de salvar. A parcela e quem não edita veem só a etiqueta.
import { useEffect, useId, useRef } from "react";
import { X } from "lucide-react";
import type { NatureView } from "@fintrack/core";
import { ActionForm } from "@/components/feedback/action-form";
import { Button } from "@/components/ui/button";
import { SPENDING_NATURE_LABEL } from "@/lib/labels";
import { cn } from "@/lib/utils";
import { setNatureAction } from "../../server/actions";
import { NATURE_ICON, NatureTag, natureTagClass } from "./nature-tag";
import { natureDefaultText, NatureRadios, PURCHASE_NATURE_OPTIONS } from "./nature-radios";
import { NATIVE_CHECK } from "@/lib/styles";

export function NaturePicker({
  item,
  canEdit,
}: {
  item: {
    id: string;
    /** O nome que a linha mostra (o "O que foi" ou a descrição) */
    name: string;
    /** O texto do banco ou a descrição: é ele que a regra da loja reconhece */
    description: string;
    category: { name: string } | null;
    natureView: NatureView;
  };
  canEdit: boolean;
}) {
  const ref = useRef<HTMLDetailsElement>(null);
  const summaryRef = useRef<HTMLElement>(null);
  const panelId = useId();
  const titleId = useId();
  const ruleId = useId();
  const { kind, choosable, categoryNature } = item.natureView;

  if (!canEdit || !choosable) return <NatureTag kind={kind} />;

  const close = () => {
    const details = ref.current;
    if (!details?.open) return;
    details.open = false;
    summaryRef.current?.focus();
  };
  const onToggle = () => {
    const details = ref.current;
    if (!details?.open) return;
    for (const other of document.querySelectorAll<HTMLDetailsElement>(
      "details[data-nature-picker][open]",
    )) {
      if (other !== details) other.open = false;
    }
    details.querySelector<HTMLInputElement>("input[type=radio]:checked")?.focus();
  };
  const Icon = NATURE_ICON[kind];
  const current = kind === "fixed" ? "FIXED" : "VARIABLE";

  return (
    <details
      ref={ref}
      data-nature-picker
      onToggle={onToggle}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          close();
        }
      }}
      className="group relative shrink-0"
    >
      <summary
        ref={summaryRef}
        aria-controls={panelId}
        // O nome começa pelo que se vê e diz de qual linha é; no texto, a linha não se repete
        aria-label={`${SPENDING_NATURE_LABEL[kind]}: trocar o tipo de ${item.name}`}
        className={cn(
          natureTagClass(kind),
          "focus-visible:ring-ring min-h-6 cursor-pointer list-none outline-none hover:underline focus-visible:ring-3 [&::-webkit-details-marker]:hidden",
        )}
      >
        <Icon aria-hidden className="size-3.5" />
        {SPENDING_NATURE_LABEL[kind]}
      </summary>
      <div aria-hidden onClick={close} className="bg-scrim fixed inset-0 z-[60] md:hidden" />
      <div
        id={panelId}
        role="dialog"
        aria-labelledby={titleId}
        className={cn(
          "bg-card text-card-foreground z-[61] flex flex-col gap-3 border shadow-[0_18px_50px_rgb(4_6_20/0.3)]",
          "fixed inset-x-0 bottom-0 max-h-[85dvh] overflow-y-auto rounded-t-3xl px-4 pt-3 pb-7",
          "md:absolute md:inset-x-auto md:top-[calc(100%+4px)] md:right-0 md:bottom-auto md:max-h-none md:w-[26rem] md:rounded-[1.125rem] md:p-4",
        )}
      >
        <span aria-hidden className="bg-border mx-auto h-1.5 w-10 rounded-full md:hidden" />
        <div className="flex items-start justify-between gap-2">
          <h3 id={titleId} className="min-w-0 text-base font-bold">
            Tipo da despesa: <span className="font-semibold">{item.name}</span>
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
        <ActionForm action={setNatureAction} aria-label={`Tipo da despesa de ${item.name}`}>
          {({ pending, state }) => (
            <NatureFormBody
              id={item.id}
              idPrefix={`${panelId}-`}
              current={current}
              description={natureDefaultText(item.category, categoryNature)}
              store={item.description}
              hasCategory={item.category !== null}
              ruleId={ruleId}
              pending={pending}
              saved={Boolean(state.success)}
              onSaved={close}
            />
          )}
        </ActionForm>
      </div>
    </details>
  );
}

function NatureFormBody({
  id,
  idPrefix,
  current,
  description,
  store,
  hasCategory,
  ruleId,
  pending,
  saved,
  onSaved,
}: {
  id: string;
  idPrefix: string;
  current: "FIXED" | "VARIABLE";
  description: string;
  store: string;
  hasCategory: boolean;
  ruleId: string;
  pending: boolean;
  saved: boolean;
  onSaved: () => void;
}) {
  // Gravou: fecha e devolve o foco à etiqueta (a página volta do servidor com o tipo novo)
  useEffect(() => {
    if (saved) onSaved();
  }, [saved, onSaved]);
  return (
    <div className="flex flex-col gap-3">
      <input type="hidden" name="transactionId" value={id} />
      <NatureRadios
        name="nature"
        legend="Tipo da despesa"
        options={PURCHASE_NATURE_OPTIONS}
        value={current}
        before={current}
        description={description}
        idPrefix={idPrefix}
      />
      {hasCategory ? (
        <label
          htmlFor={ruleId}
          className="flex min-h-11 cursor-pointer items-start gap-2.5 text-sm"
        >
          <input
            id={ruleId}
            type="checkbox"
            name="rememberRule"
            className={cn(NATIVE_CHECK, "mt-0.5 size-5")}
          />
          <span>
            <strong>As próximas de “{store}” também</strong>
            <span className="text-muted-foreground block text-[0.8125rem]">
              vale para o que chegar do banco com o mesmo texto, com esta categoria e este tipo
            </span>
          </span>
        </label>
      ) : (
        <p className="text-muted-foreground text-[0.8125rem]">
          Escolha a categoria para valer também nas próximas desta loja.
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button type="submit" disabled={pending}>
          Salvar
        </Button>
      </div>
    </div>
  );
}
