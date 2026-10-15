"use client";

// "Cancelar" e "Importar N lançamentos" (M09.3); na fatura em PDF (M09.4), "Importar N
// lançamentos e a fatura", ou "Importar mesmo assim" quando a fatura não confere. Dois formulários, cada um com a sua Server
// Action direta no useActionState (funcionam antes do React carregar). No celular os botões
// ficam lado a lado embaixo do cartão; no computador, à direita, dentro dele.
import { Upload } from "lucide-react";
import { ActionForm } from "@/components/feedback/action-form";
import { Button } from "@/components/ui/button";
import { cancelImportAction, importFileAction } from "../../server/import-actions";

export function ImportFooter({
  importId,
  accountId,
  count,
  invoice = null,
}: {
  importId: string;
  accountId: string | null;
  count: number;
  /** Fatura em PDF: entra junto, e o botão diz se ela confere */
  invoice?: { matches: boolean } | null;
}) {
  const rows = count === 1 ? "Importar 1 lançamento" : `Importar ${count} lançamentos`;
  const label = !invoice ? rows : invoice.matches ? `${rows} e a fatura` : "Importar mesmo assim";
  const short = invoice && !invoice.matches ? "Importar mesmo assim" : `Importar ${count}`;
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)] items-end gap-2.5 md:flex md:justify-end md:border-t md:pt-3">
      <ActionForm action={cancelImportAction} aria-label="Cancelar a importação">
        {({ pending }) => (
          <>
            <input type="hidden" name="importId" value={importId} />
            <Button
              type="submit"
              variant="outline"
              disabled={pending}
              className="h-11 w-full rounded-xl px-4 text-sm font-bold md:w-auto"
            >
              Cancelar
            </Button>
          </>
        )}
      </ActionForm>
      <ActionForm action={importFileAction} aria-label="Importar o arquivo">
        {({ pending }) => (
          <>
            <input type="hidden" name="importId" value={importId} />
            <input type="hidden" name="accountId" value={accountId ?? ""} />
            <Button
              type="submit"
              disabled={pending || !accountId}
              aria-label={label}
              className="h-11 w-full gap-2 rounded-xl px-[1.125rem] text-sm font-bold md:w-auto"
            >
              <Upload aria-hidden className="size-[1.125rem]" />
              <span className="md:hidden">{pending ? "Importando…" : short}</span>
              <span className="hidden md:inline">{pending ? "Importando…" : label}</span>
            </Button>
          </>
        )}
      </ActionForm>
    </div>
  );
}
