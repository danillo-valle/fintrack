"use client";

import { Button } from "@/components/ui/button";
import { useRouteModal } from "@/components/ui/route-modal";
import { useEntry } from "./entry-provider";

/** "Salvar despesa" / "Salvar receita" / "Salvar alterações": fora do <form>, ligado por form=. */
export function EntrySubmit({ className }: { className?: string }) {
  const e = useEntry();
  const label = e.editing
    ? "Salvar alterações"
    : e.kind === "expense"
      ? "Salvar despesa"
      : "Salvar receita";
  return (
    <Button
      type="submit"
      form={e.formId}
      size="lg"
      disabled={e.pending}
      className={className ?? "h-11 rounded-xl px-[1.375rem] font-extrabold"}
    >
      {e.pending ? "Salvando…" : label}
    </Button>
  );
}

/** Rodapé do modal: Cancelar e Salvar. No celular, só o Salvar, na largura toda (o painel já tem
 * Fechar no topo e a alça para arrastar). */
export function EntryModalActions() {
  const modal = useRouteModal();
  return (
    <div className="flex flex-wrap justify-end gap-2.5">
      <Button
        type="button"
        variant="outline"
        size="lg"
        onClick={modal.close}
        className="hidden h-11 rounded-xl px-[1.125rem] font-semibold md:inline-flex"
      >
        Cancelar
      </Button>
      <EntrySubmit className="h-[3.25rem] w-full rounded-[0.875rem] text-base font-extrabold md:h-11 md:w-auto md:rounded-xl md:px-[1.375rem] md:text-sm" />
    </div>
  );
}

/** Subtítulo do modal: em qual ambiente o lançamento vai entrar (muda junto com o campo). */
export function EntryWalletLabel() {
  const e = useEntry();
  if (!e.wallet) return null;
  return (
    <>
      No ambiente <strong className="text-foreground">{e.wallet.name}</strong>
    </>
  );
}
