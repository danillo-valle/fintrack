"use client";

// A lista de lançamentos (M07), agrupada por dia. Excluir é OTIMISTA: a linha some na hora
// (useOptimistic) e o aviso oferece "Desfazer" por 10 s. Se o servidor recusar, a linha volta
// sozinha (o estado otimista dura só até a resposta) e o erro aparece num aviso.
import Link from "next/link";
import { useOptimistic, useTransition } from "react";
import { toast } from "sonner";
import { ArrowLeftRight, CalendarClock, Trash2 } from "lucide-react";
import type { CivilDate } from "@fintrack/core";
import { undoToast } from "@/components/feedback/undo-toast";
import { AmountText } from "@/components/money/amount-text";
import { Button } from "@/components/ui/button";
import { INITIAL_ACTION_STATE } from "@/lib/action-state";
import { formatDateLong } from "@/lib/dates";
import { deleteTransactionAction, restoreTransactionAction } from "../server/actions";

export type ListItem = {
  id: string;
  occurredOn: CivilDate;
  description: string;
  amount: bigint;
  status: "PENDING" | "SCHEDULED" | "CONFIRMED";
  transferId: string | null;
  canEdit: boolean;
  wallet: { name: string };
  account: { name: string };
  category: { name: string } | null;
  card: { nickname: string } | null;
};

/** "2026-10-07" → "7 de outubro de 2026" (meio-dia UTC: nenhum fuso muda o dia). */
function dayTitle(date: CivilDate) {
  return formatDateLong(new Date(`${date}T12:00:00Z`));
}

function formData(id: string) {
  const data = new FormData();
  data.set("transactionId", id);
  return data;
}

export function TransactionList({ items }: { items: ListItem[] }) {
  const [, startTransition] = useTransition();
  const [visible, hide] = useOptimistic(items, (current, id: string) =>
    current.filter((item) => item.id !== id),
  );

  function remove(item: ListItem) {
    startTransition(async () => {
      hide(item.id);
      const result = await deleteTransactionAction(INITIAL_ACTION_STATE, formData(item.id));
      if (result.error) {
        toast.error(result.error);
        return;
      }
      undoToast(`“${item.description}” excluído`, {
        onUndo: () => {
          startTransition(async () => {
            const back = await restoreTransactionAction(INITIAL_ACTION_STATE, formData(item.id));
            if (back.error) toast.error(back.error);
            else toast("Lançamento de volta");
          });
        },
      });
    });
  }

  // Agrupa por dia, mantendo a ordem (do mais recente para o mais antigo)
  const days: { date: CivilDate; items: ListItem[] }[] = [];
  for (const item of visible) {
    const last = days.at(-1);
    if (last && last.date === item.occurredOn) last.items.push(item);
    else days.push({ date: item.occurredOn, items: [item] });
  }

  return (
    <div className="flex flex-col gap-6">
      {days.map((day) => (
        <section key={day.date} aria-label={dayTitle(day.date)}>
          <h2 className="text-muted-foreground mb-2 text-sm font-medium">{dayTitle(day.date)}</h2>
          <ul className="bg-card divide-y rounded-xl border">
            {day.items.map((item) => (
              <li key={item.id} className="flex items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <Link
                    href={`/lancamentos/${item.id}`}
                    className="focus-visible:ring-ring block rounded font-medium break-words outline-none hover:underline focus-visible:ring-3"
                  >
                    {item.description}
                  </Link>
                  <p className="text-muted-foreground flex flex-wrap items-center gap-x-2 text-sm">
                    {item.transferId ? (
                      <span className="inline-flex items-center gap-1">
                        <ArrowLeftRight aria-hidden className="size-3.5" />
                        Transferência
                      </span>
                    ) : (
                      <span>{item.category?.name ?? "Sem categoria"}</span>
                    )}
                    <span aria-hidden>·</span>
                    <span className="break-words">
                      {item.account.name}
                      {item.card ? ` (${item.card.nickname})` : ""}
                    </span>
                    <span aria-hidden>·</span>
                    <span className="break-words">{item.wallet.name}</span>
                    {item.status === "SCHEDULED" ? (
                      <span className="border-border inline-flex items-center gap-1 rounded border px-1.5 text-xs">
                        <CalendarClock aria-hidden className="size-3" />
                        Agendado
                      </span>
                    ) : null}
                  </p>
                </div>
                <AmountText cents={item.amount} />
                {item.canEdit ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-lg"
                    aria-label={`Excluir ${item.description}`}
                    onClick={() => remove(item)}
                  >
                    <Trash2 aria-hidden />
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
