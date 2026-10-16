"use client";

// "Treinar agora" (M10.1): a Server Action direta no <form> (funciona antes do React, regra do
// M08); o aviso do resultado aparece logo acima do botão.
import { RefreshCw } from "lucide-react";
import { ActionForm } from "@/components/feedback/action-form";
import { Button } from "@/components/ui/button";
import { trainNowAction } from "../server/actions";

export function TrainButton({ disabled = false }: { disabled?: boolean }) {
  return (
    <ActionForm action={trainNowAction} aria-label="Treinar o classificador agora">
      {({ pending }) => (
        <Button
          type="submit"
          variant="outline"
          disabled={disabled || pending}
          className="mt-1 h-11 gap-2 rounded-xl px-4 text-sm font-semibold md:h-10"
        >
          <RefreshCw aria-hidden className={pending ? "animate-spin" : undefined} />
          {pending ? "Treinando…" : "Treinar agora"}
        </Button>
      )}
    </ActionForm>
  );
}
