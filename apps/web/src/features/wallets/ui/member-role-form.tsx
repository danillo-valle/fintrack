"use client";

import type { WalletRole } from "@fintrack/core";
import { ActionForm } from "@/components/feedback/action-form";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { WALLET_ROLE_LABEL } from "@/lib/access-messages";
import { setRoleAction } from "../server/actions";

type Props = { walletId: string; userId: string; name: string; role: WalletRole };

// Trocar o papel de uma pessoa na carteira (só aparece para quem é dono).
export function MemberRoleForm({ walletId, userId, name, role }: Props) {
  const selectId = `papel-${userId}`;
  return (
    <ActionForm
      action={setRoleAction}
      idPrefix={`${selectId}-`}
      className="flex flex-col items-end"
    >
      {({ pending }) => (
        <div className="flex flex-wrap items-center gap-2">
          <input type="hidden" name="walletId" value={walletId} />
          <input type="hidden" name="userId" value={userId} />
          <label htmlFor={selectId} className="sr-only">
            Papel de {name}
          </label>
          <NativeSelect id={selectId} name="role" defaultValue={role}>
            {(["OWNER", "EDITOR", "VIEWER"] as const).map((r) => (
              <option key={r} value={r}>
                {WALLET_ROLE_LABEL[r]}
              </option>
            ))}
          </NativeSelect>
          <Button
            type="submit"
            size="sm"
            variant="outline"
            disabled={pending}
            aria-label={`Salvar o papel de ${name}`}
          >
            Salvar
          </Button>
        </div>
      )}
    </ActionForm>
  );
}
