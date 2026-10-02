"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Fingerprint, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";
import { authErrorMessage, isCancelled } from "@/lib/auth/messages";
import { formatDate } from "@/lib/dates";
import { FormAlert } from "./form-alert";

export type PasskeyItem = { id: string; name: string | null; createdAt: string | null };

const BACK = "/ajustes/seguranca";

// Lista, cadastra e remove passkeys. Cadastrar e remover são ações sensíveis: se o login foi
// há mais de 10 minutos, o servidor responde REAUTH_REQUIRED e a pessoa confirma a identidade.
export function PasskeyManager({ passkeys }: { passkeys: PasskeyItem[] }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  function handleError(error: { code?: string | undefined; status?: number | undefined }) {
    if (error.code === "REAUTH_REQUIRED") {
      router.push(`/reautenticar?next=${encodeURIComponent(BACK)}`);
      return;
    }
    if (isCancelled(error)) return; // a pessoa fechou a janela do aparelho
    setError(authErrorMessage(error));
  }

  async function add() {
    setPending(true);
    setError(null);
    const result = await authClient.passkey.addPasskey({ name: "Passkey do FinTrack" });
    setPending(false);
    if (result?.error) return handleError(result.error);
    router.refresh();
  }

  async function remove(id: string) {
    setError(null);
    const { error } = await authClient.passkey.deletePasskey({ id });
    if (error) return handleError(error);
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-4">
      <FormAlert message={error} />
      {passkeys.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          Nenhuma passkey ainda. Com uma, você entra pela digital ou pelo rosto, sem digitar senha,
          e um site falso não consegue usá-la.
        </p>
      ) : (
        <ul className="divide-y rounded-lg border">
          {passkeys.map((item) => (
            <li key={item.id} className="flex items-center justify-between gap-3 px-4 py-3">
              <span className="flex min-w-0 items-center gap-2">
                <Fingerprint aria-hidden className="size-4 shrink-0" />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">
                    {item.name ?? "Passkey"}
                  </span>
                  {item.createdAt ? (
                    <span className="text-muted-foreground block text-xs">
                      Criada em {formatDate(new Date(item.createdAt))}
                    </span>
                  ) : null}
                </span>
              </span>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => remove(item.id)}
                aria-label={`Remover ${item.name ?? "passkey"}`}
              >
                <Trash2 aria-hidden />
              </Button>
            </li>
          ))}
        </ul>
      )}
      <div>
        <Button type="button" variant="outline" onClick={add} disabled={pending}>
          <Plus aria-hidden />
          {pending ? "Aguardando o aparelho…" : "Adicionar passkey"}
        </Button>
      </div>
    </div>
  );
}
