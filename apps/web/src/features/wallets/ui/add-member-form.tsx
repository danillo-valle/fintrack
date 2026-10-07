"use client";

import { UserPlus } from "lucide-react";
import { ActionForm } from "@/components/feedback/action-form";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { WALLET_ROLE_HELP, WALLET_ROLE_LABEL } from "@/lib/access-messages";
import { addMemberAction } from "../server/actions";

type Person = { userId: string; name: string };

// Adicionar alguém do lar que ainda não participa da carteira.
export function AddMemberForm({ walletId, people }: { walletId: string; people: Person[] }) {
  return (
    <ActionForm action={addMemberAction} idPrefix="adicionar-" className="flex flex-col gap-3">
      {({ pending }) => (
        <div className="flex flex-wrap items-end gap-3">
          <input type="hidden" name="walletId" value={walletId} />
          <div className="flex flex-col gap-1">
            <label htmlFor="add-person" className="text-sm font-medium">
              Pessoa
            </label>
            <NativeSelect id="add-person" name="userId">
              {people.map((p) => (
                <option key={p.userId} value={p.userId}>
                  {p.name}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="add-role" className="text-sm font-medium">
              Papel
            </label>
            <NativeSelect id="add-role" name="role" defaultValue="EDITOR">
              {(["OWNER", "EDITOR", "VIEWER"] as const).map((role) => (
                <option key={role} value={role}>
                  {WALLET_ROLE_LABEL[role]}: {WALLET_ROLE_HELP[role]}
                </option>
              ))}
            </NativeSelect>
          </div>
          <Button type="submit" variant="outline" disabled={pending}>
            <UserPlus aria-hidden />
            Adicionar
          </Button>
        </div>
      )}
    </ActionForm>
  );
}
