"use client";

// Exportar CSV (M07). O servidor monta o arquivo (só para o dono, com reautenticação recente e
// registro na auditoria) e devolve o conteúdo; aqui o navegador o oferece para baixar.
import { useActionState, useEffect } from "react";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { FormAlert } from "@/features/auth/ui/form-alert";
import { INITIAL_ACTION_STATE } from "@/lib/action-state";
import { exportTransactionsAction, type ExportState } from "../server/actions";

const INITIAL: ExportState = { ...INITIAL_ACTION_STATE, file: null };

export function ExportForm({
  wallets,
  defaults,
}: {
  wallets: { id: string; name: string }[];
  defaults: { walletId: string | null; from: string; to: string };
}) {
  const [state, action, pending] = useActionState(exportTransactionsAction, INITIAL);

  // Arquivo pronto: um link temporário para o navegador baixar (o conteúdo nunca vai para a URL)
  useEffect(() => {
    if (!state.file) return;
    const url = URL.createObjectURL(
      new Blob([state.file.content], { type: "text/csv;charset=utf-8" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = state.file.name;
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }, [state.file]);

  return (
    <form action={action} className="flex max-w-md flex-col gap-4">
      <FormAlert message={state.error} />
      <FormAlert message={state.error ? null : state.success} variant="success" />
      <Field>
        <FieldLabel htmlFor="exp-wallet">Carteira</FieldLabel>
        <NativeSelect
          id="exp-wallet"
          name="walletId"
          defaultValue={defaults.walletId ?? wallets[0]?.id ?? ""}
          className="h-10"
        >
          {wallets.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field>
          <FieldLabel htmlFor="exp-from">De</FieldLabel>
          <Input
            id="exp-from"
            name="from"
            type="date"
            defaultValue={defaults.from}
            className="h-10"
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="exp-to">Até</FieldLabel>
          <Input id="exp-to" name="to" type="date" defaultValue={defaults.to} className="h-10" />
        </Field>
      </div>
      <Button type="submit" className="self-start" disabled={pending}>
        <Download aria-hidden />
        {pending ? "Gerando…" : "Baixar CSV"}
      </Button>
    </form>
  );
}
