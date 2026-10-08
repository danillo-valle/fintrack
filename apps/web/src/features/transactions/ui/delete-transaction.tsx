"use client";

// Excluir no detalhe do lançamento (M07): pergunta no lugar do botão, exclui, volta para a
// lista e oferece "Desfazer" por 10 s (o aviso continua na tela depois da navegação).
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import { undoToast } from "@/components/feedback/undo-toast";
import { Button } from "@/components/ui/button";
import { INITIAL_ACTION_STATE } from "@/lib/action-state";
import { deleteTransactionAction, restoreTransactionAction } from "../server/actions";

export function DeleteTransaction({ id, label }: { id: string; label: string }) {
  const router = useRouter();
  const [asking, setAsking] = useState(false);
  const [pending, startTransition] = useTransition();
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (asking) confirmRef.current?.focus();
  }, [asking]);

  function data() {
    const form = new FormData();
    form.set("transactionId", id);
    return form;
  }

  function remove() {
    startTransition(async () => {
      const result = await deleteTransactionAction(INITIAL_ACTION_STATE, data());
      if (result.error) {
        toast.error(result.error);
        return;
      }
      router.push("/lancamentos");
      undoToast(`“${label}” excluído`, {
        onUndo: () => {
          startTransition(async () => {
            const back = await restoreTransactionAction(INITIAL_ACTION_STATE, data());
            if (back.error) toast.error(back.error);
            else {
              toast("Lançamento de volta");
              router.refresh();
            }
          });
        },
      });
    });
  }

  if (!asking) {
    return (
      <Button type="button" variant="outline" onClick={() => setAsking(true)}>
        <Trash2 aria-hidden />
        Excluir lançamento
      </Button>
    );
  }
  return (
    <span
      role="group"
      aria-label="Excluir este lançamento?"
      className="flex flex-wrap items-center gap-2"
    >
      <span className="text-sm">Excluir este lançamento? Dá para desfazer.</span>
      <Button
        ref={confirmRef}
        type="button"
        variant="destructive"
        size="sm"
        disabled={pending}
        onClick={remove}
      >
        {pending ? "Aguarde…" : "Sim, excluir"}
      </Button>
      <Button type="button" variant="ghost" size="sm" onClick={() => setAsking(false)}>
        Não
      </Button>
    </span>
  );
}
