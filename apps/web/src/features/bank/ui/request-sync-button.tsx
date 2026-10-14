"use client";

// "Buscar agora" (M09.1): põe uma busca na fila. Lê o que o Meu Pluggy já tem (ele atualiza cada
// banco uma vez por dia); não pede ao banco dados mais novos. Funciona antes do JavaScript
// carregar (Server Action direta no <form>, regra do M08).
import { RefreshCw } from "lucide-react";
import { ActionForm } from "@/components/feedback/action-form";
import { Button } from "@/components/ui/button";
import { requestSyncAction } from "../server/actions";

export function RequestSyncButton() {
  return (
    <ActionForm
      action={requestSyncAction}
      aria-label="Buscar agora"
      className="flex flex-wrap items-center gap-2"
    >
      {({ pending }) => (
        <Button
          type="submit"
          variant="outline"
          disabled={pending}
          className="h-10 gap-2 rounded-xl px-4 text-sm font-semibold"
        >
          <RefreshCw aria-hidden className={pending ? "animate-spin" : undefined} />
          Buscar agora
        </Button>
      )}
    </ActionForm>
  );
}
