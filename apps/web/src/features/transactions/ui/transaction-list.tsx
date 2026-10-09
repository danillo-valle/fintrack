"use client";

// A lista de lançamentos (M07; visual do M07.2), agrupada por dia: no celular, ícone colorido +
// descrição + valor; a partir de 1024 px, as mesmas linhas viram colunas (categoria, carteira,
// conta), sem duplicar o HTML. Excluir é OTIMISTA: a linha some na hora
// (useOptimistic) e o aviso oferece "Desfazer" por 10 s. Se o servidor recusar, a linha volta
// sozinha (o estado otimista dura só até a resposta) e o erro aparece num aviso.
import Link from "next/link";
import { useOptimistic, useTransition } from "react";
import { toast } from "sonner";
import { ArrowLeftRight, CalendarClock, CircleDashed, Trash2 } from "lucide-react";
import type { CivilDate } from "@fintrack/core";
import { undoToast } from "@/components/feedback/undo-toast";
import { AmountText } from "@/components/money/amount-text";
import { Button } from "@/components/ui/button";
import { IconTile } from "@/components/visual/icon-tile";
import { toneFor } from "@/components/visual/tone";
import { INITIAL_ACTION_STATE } from "@/lib/action-state";
import { dayLabel } from "../presentation";
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
  category: { id: string; name: string } | null;
  card: { nickname: string } | null;
};

function formData(id: string) {
  const data = new FormData();
  data.set("transactionId", id);
  return data;
}

// As colunas do desktop (lg): ícone, descrição, categoria, carteira, conta, valor, excluir
const ROW =
  "grid grid-cols-[auto_minmax(0,1fr)_auto_auto] items-center gap-x-3 px-4 py-3 lg:grid-cols-[auto_minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto_auto]";

function Leading({ item }: { item: ListItem }) {
  if (item.transferId) return <IconTile tone={1} icon={ArrowLeftRight} size="sm" />;
  if (!item.category) return <IconTile tone="neutral" icon={CircleDashed} size="sm" />;
  return <IconTile tone={toneFor(item.category.id)} letter={item.category.name} size="sm" />;
}

function categoryName(item: ListItem) {
  return item.transferId ? "Transferência" : (item.category?.name ?? "Sem categoria");
}

export function TransactionList({
  items,
  today,
  readOnly = false,
  dayHeading: DayHeading = "h2",
}: {
  items: ListItem[];
  /** Hoje em São Paulo (do servidor), para os títulos "Hoje" e "Ontem" */
  today: CivilDate;
  /** Sem o botão de excluir (o resumo do Início) */
  readOnly?: boolean;
  /** Nível do título de cada dia: h3 quando a lista está dentro de uma seção com h2 */
  dayHeading?: "h2" | "h3";
}) {
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
    <div className="flex flex-col gap-5">
      {days.map((day) => {
        const title = dayLabel(day.date, today);
        return (
          <section key={day.date} aria-label={title}>
            <DayHeading className="text-muted-foreground mb-2 px-1 text-sm font-semibold">
              {title}
            </DayHeading>
            <ul className="bg-card divide-y overflow-hidden rounded-2xl border">
              {day.items.map((item) => (
                <li key={item.id} className={ROW}>
                  <Leading item={item} />
                  {/* No celular: descrição e, embaixo, uma linha de detalhes. No desktop, o
                      "display: contents" solta os mesmos elementos no grid e eles viram colunas:
                      nenhum texto aparece duas vezes no HTML. */}
                  <div className="min-w-0 lg:contents">
                    <Link
                      href={`/lancamentos/${item.id}`}
                      className="focus-visible:ring-ring block min-w-0 rounded font-medium break-words outline-none hover:underline focus-visible:ring-3"
                    >
                      {item.description}
                    </Link>
                    <p className="text-muted-foreground flex flex-wrap items-center gap-x-2 text-sm lg:contents">
                      <span className="lg:bg-muted lg:text-foreground min-w-0 lg:w-fit lg:max-w-full lg:truncate lg:rounded-md lg:px-2 lg:py-0.5">
                        {categoryName(item)}
                        {item.status === "SCHEDULED" ? <Scheduled /> : null}
                      </span>
                      <span aria-hidden className="lg:hidden">
                        ·
                      </span>
                      <span className="lg:text-foreground min-w-0 break-words lg:truncate">
                        {item.wallet.name}
                      </span>
                      <span aria-hidden className="lg:hidden">
                        ·
                      </span>
                      <span className="min-w-0 break-words lg:truncate">
                        {item.account.name}
                        {item.card ? ` (${item.card.nickname})` : ""}
                      </span>
                    </p>
                  </div>
                  <AmountText cents={item.amount} className="justify-self-end" />
                  {item.canEdit && !readOnly ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-lg"
                      aria-label={`Excluir ${item.description}`}
                      onClick={() => remove(item)}
                    >
                      <Trash2 aria-hidden />
                    </Button>
                  ) : (
                    <span className="size-9" />
                  )}
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

function Scheduled() {
  return (
    <span className="border-border ml-1 inline-flex items-center gap-1 rounded border px-1.5 text-xs">
      <CalendarClock aria-hidden className="size-3" />
      Agendado
    </span>
  );
}
