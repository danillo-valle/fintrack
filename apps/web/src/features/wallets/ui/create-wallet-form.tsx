"use client";

import { Plus } from "lucide-react";
import { ActionForm } from "@/components/feedback/action-form";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { WALLET_ROLE_HELP, WALLET_ROLE_LABEL } from "@/lib/access-messages";
import { createWalletAction } from "../server/actions";

type Person = { userId: string; name: string };

// Nova carteira compartilhada: nome e quem participa (cada pessoa com o próprio papel).
// Quem cria é sempre dono; por isso não aparece na lista.
export function CreateWalletForm({ others }: { others: Person[] }) {
  return (
    <ActionForm
      action={createWalletAction}
      idPrefix="nova-"
      className="flex max-w-xl flex-col gap-6"
    >
      {({ pending, field }) => {
        const name = field("name");
        return (
          <>
            <Field data-invalid={name.error ? true : undefined}>
              <FieldLabel htmlFor="wallet-name">Nome da carteira</FieldLabel>
              <Input
                id="wallet-name"
                name="name"
                required
                maxLength={60}
                autoComplete="off"
                placeholder="Ex.: Casa, Viagem 2027"
                data-msg-missing="Dê um nome à carteira."
                {...name.props}
              />
              <FieldError id={name.errorId}>{name.error}</FieldError>
            </Field>

            <FieldSet>
              <FieldLegend variant="label">Quem mais participa</FieldLegend>
              {others.length === 0 ? (
                <p className="text-muted-foreground text-sm">
                  Só você por enquanto. Convide alguém em Ajustes &gt; Lar.
                </p>
              ) : (
                <ul className="flex flex-col gap-3">
                  {others.map((person) => (
                    <li key={person.userId} className="flex flex-wrap items-center gap-3">
                      <label className="flex min-w-40 items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          name="member"
                          value={person.userId}
                          defaultChecked
                          className="accent-primary focus-visible:ring-ring size-4 rounded outline-none focus-visible:ring-3"
                        />
                        {person.name}
                      </label>
                      <label className="sr-only" htmlFor={`role-${person.userId}`}>
                        Papel de {person.name}
                      </label>
                      <NativeSelect
                        id={`role-${person.userId}`}
                        name={`role:${person.userId}`}
                        defaultValue="EDITOR"
                      >
                        {(["OWNER", "EDITOR", "VIEWER"] as const).map((role) => (
                          <option key={role} value={role}>
                            {WALLET_ROLE_LABEL[role]}: {WALLET_ROLE_HELP[role]}
                          </option>
                        ))}
                      </NativeSelect>
                    </li>
                  ))}
                </ul>
              )}
            </FieldSet>

            <Button type="submit" size="lg" className="h-11 self-start" disabled={pending}>
              <Plus aria-hidden />
              {pending ? "Criando…" : "Criar carteira"}
            </Button>
          </>
        );
      }}
    </ActionForm>
  );
}
