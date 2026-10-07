"use client";

import { Check } from "lucide-react";
import { ActionForm } from "@/components/feedback/action-form";
import { Button } from "@/components/ui/button";
import { acceptInviteAction } from "../server/actions";

// O botão "Aceitar convite" da tela /convite/<segredo>. O segredo vai num campo escondido;
// o servidor confere tudo de novo (prazo, uso único, e-mail da conta).
export function AcceptInviteForm({ token }: { token: string }) {
  return (
    <ActionForm action={acceptInviteAction}>
      {({ pending }) => (
        <>
          <input type="hidden" name="token" value={token} />
          <Button type="submit" size="lg" className="h-11" disabled={pending}>
            <Check aria-hidden />
            {pending ? "Entrando…" : "Aceitar convite"}
          </Button>
        </>
      )}
    </ActionForm>
  );
}
