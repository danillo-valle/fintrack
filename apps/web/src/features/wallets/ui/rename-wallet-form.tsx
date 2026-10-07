"use client";

import { ActionForm } from "@/components/feedback/action-form";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { renameWalletAction } from "../server/actions";

export function RenameWalletForm({ walletId, name }: { walletId: string; name: string }) {
  return (
    <ActionForm action={renameWalletAction} idPrefix="renomear-" className="flex flex-col gap-3">
      {({ pending, field }) => {
        const f = field("name");
        return (
          <>
            <input type="hidden" name="walletId" value={walletId} />
            <Field data-invalid={f.error ? true : undefined}>
              <FieldLabel htmlFor="rename">Nome</FieldLabel>
              <div className="flex flex-wrap gap-2">
                <Input
                  id="rename"
                  name="name"
                  required
                  maxLength={60}
                  defaultValue={name}
                  autoComplete="off"
                  data-msg-missing="Dê um nome à carteira."
                  className="max-w-xs"
                  {...f.props}
                />
                <Button type="submit" variant="outline" disabled={pending}>
                  {pending ? "Salvando…" : "Salvar nome"}
                </Button>
              </div>
              <FieldError id={f.errorId}>{f.error}</FieldError>
            </Field>
          </>
        );
      }}
    </ActionForm>
  );
}
