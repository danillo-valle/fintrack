"use client";

// A lista de lançamentos (M07; visual do M07.3, opção B do canvas), agrupada por dia.
//
//   computador  [ícone] Descrição ........ [Categoria] (Ambiente) Conta/cartão .... valor [lixeira]
//   celular     [ícone] Descrição ......................................... valor
//                       [Categoria] (Ambiente)
//
// Uma linha só no HTML: no computador, "display: contents" solta os detalhes no grid e eles viram
// colunas; nenhum texto aparece duas vezes. Categoria e ambiente têm largura fixa, para as colunas
// ficarem alinhadas linha a linha. Excluir é OTIMISTA (useOptimistic) com "Desfazer" por 10 s.
// No celular, excluir fica na página do lançamento (a linha é curta demais para a lixeira).
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
import { cn } from "@/lib/utils";
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
  wallet: { name: string; kind: "PERSONAL" | "SHARED" };
  account: { name: string };
  category: { id: string; name: string } | null;
  card: { nickname: string; lastFour: string } | null;
};

function formData(id: string) {
  const data = new FormData();
  data.set("transactionId", id);
  return data;
}

// As colunas do computador (lg): ícone, descrição, categoria, ambiente, conta, valor, excluir
const ROW =
  "grid grid-cols-[2.5rem_minmax(0,1fr)_auto] items-center gap-x-3 px-3.5 py-3 lg:grid-cols-[2.5rem_minmax(0,2fr)_8rem_6rem_minmax(0,1.2fr)_8.25rem_2.25rem] lg:gap-x-3.5 lg:px-[1.125rem]";

/** Quem paga: o cartão (apelido e final) ou, sem cartão, a conta. Só os 4 últimos dígitos. */
export function payingWith(item: Pick<ListItem, "account" | "card">): string {
  return item.card ? `${item.card.nickname} final ${item.card.lastFour}` : item.account.name;
}

function categoryName(item: ListItem) {
  return item.transferId ? "Transferência" : (item.category?.name ?? "Sem categoria");
}

export function TransactionList({
  items,
  today,
  readOnly = false,
  dayHeading = "h2",
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

  return (
    <div className="flex flex-col gap-5">
      {groupByDay(visible).map((day) => (
        <DayGroup
          key={day.date}
          title={dayLabel(day.date, today)}
          heading={dayHeading}
          items={day.items}
          onRemove={readOnly ? null : remove}
        />
      ))}
    </div>
  );
}

/** Agrupa por dia, mantendo a ordem (do mais recente para o mais antigo). */
function groupByDay(items: ListItem[]) {
  const days: { date: CivilDate; items: ListItem[] }[] = [];
  for (const item of items) {
    const last = days.at(-1);
    if (last && last.date === item.occurredOn) last.items.push(item);
    else days.push({ date: item.occurredOn, items: [item] });
  }
  return days;
}

function DayGroup({
  title,
  heading: Heading,
  items,
  onRemove,
}: {
  title: string;
  heading: "h2" | "h3";
  items: ListItem[];
  onRemove: ((item: ListItem) => void) | null;
}) {
  return (
    <section aria-label={title} className="flex flex-col gap-2">
      <Heading className="text-muted-foreground px-1 text-sm font-bold">{title}</Heading>
      <ul className="bg-card divide-y overflow-hidden rounded-[1.125rem] border">
        {items.map((item) => (
          <TransactionRow key={item.id} item={item} onRemove={onRemove} />
        ))}
      </ul>
    </section>
  );
}

function TransactionRow({
  item,
  onRemove,
}: {
  item: ListItem;
  onRemove: ((item: ListItem) => void) | null;
}) {
  return (
    <li className={ROW}>
      <Leading item={item} />
      {/* No celular: descrição e, embaixo, categoria e ambiente. No computador, o
          "display: contents" solta os mesmos elementos no grid e eles viram colunas. */}
      <div className="flex min-w-0 flex-col gap-1.5 lg:contents">
        <span className="flex min-w-0 items-center gap-2">
          <Link
            href={`/lancamentos/${item.id}`}
            className="focus-visible:ring-ring min-w-0 truncate rounded text-[0.9375rem] font-semibold outline-none hover:underline focus-visible:ring-3 lg:text-base"
          >
            {item.description}
          </Link>
          {item.status === "SCHEDULED" ? <Scheduled /> : null}
        </span>
        <span className="flex gap-1.5 lg:contents">
          <CategoryTag name={categoryName(item)} />
          <WalletTag wallet={item.wallet} />
          <span className="text-muted-foreground hidden min-w-0 truncate text-sm lg:block">
            {payingWith(item)}
          </span>
        </span>
      </div>
      <AmountText
        cents={item.amount}
        className="justify-self-end text-[0.9375rem] font-bold lg:text-base"
      />
      {onRemove && item.canEdit ? (
        <Button
          type="button"
          variant="ghost"
          size="icon-lg"
          aria-label={`Excluir ${item.description}`}
          onClick={() => onRemove(item)}
          className="text-muted-foreground hidden lg:inline-flex"
        >
          <Trash2 aria-hidden />
        </Button>
      ) : (
        <span aria-hidden className="hidden lg:block" />
      )}
    </li>
  );
}

function Leading({ item }: { item: ListItem }) {
  const size = "size-10";
  if (item.transferId)
    return <IconTile tone={1} icon={ArrowLeftRight} size="sm" className={size} />;
  if (!item.category) {
    return <IconTile tone="neutral" icon={CircleDashed} size="sm" className={size} />;
  }
  return (
    <IconTile
      tone={toneFor(item.category.id)}
      letter={item.category.name}
      size="sm"
      className={size}
    />
  );
}

/** A categoria numa etiqueta de largura fixa (92 px no celular, 128 px no computador). */
function CategoryTag({ name }: { name: string }) {
  return (
    <span
      title={name}
      className="bg-muted w-[5.75rem] shrink-0 truncate rounded-[0.4375rem] px-2 py-0.5 text-center text-xs font-medium lg:w-32 lg:rounded-lg lg:px-2.5 lg:py-1 lg:text-[0.8125rem]"
    >
      {name}
    </span>
  );
}

/** O ambiente (carteira) numa pílula: compartilhado em verde-azulado, pessoal em cinza. */
function WalletTag({ wallet }: { wallet: ListItem["wallet"] }) {
  return (
    <span
      title={`Ambiente ${wallet.name}`}
      className={cn(
        "w-[4.5rem] shrink-0 truncate rounded-full border px-2 py-px text-center text-xs font-semibold lg:w-24 lg:py-0.5 lg:text-[0.8125rem]",
        wallet.kind === "SHARED" ? "border-chart-5 text-chart-5" : "text-muted-foreground",
      )}
    >
      {wallet.name}
    </span>
  );
}

function Scheduled() {
  return (
    <span className="text-muted-foreground inline-flex shrink-0 items-center gap-1 rounded-md border px-1.5 text-xs">
      <CalendarClock aria-hidden className="size-3" />
      Agendado
    </span>
  );
}
