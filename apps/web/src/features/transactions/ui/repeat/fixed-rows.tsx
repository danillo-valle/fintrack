// As linhas de Fixas e parcelas (M13.3c, canvas O-Fixas): a recorrência (o nome, a categoria e a
// conta, quando cai, a regra do valor e o fim, o valor previsto e o "⋯" com Mudar o valor e Parar
// de repetir) e a compra parcelada (a parcela de agora, quantas faltam, o que falta pagar). As
// colunas seguem a largura da lista (@container), não a da tela.
import Link from "next/link";
import { Layers, Pencil, Square, Wallet } from "lucide-react";
import { ActionButton } from "@/components/feedback/action-button";
import { AmountText } from "@/components/money/amount-text";
import { ActionsMenu, MENU_ITEM, MenuSeparator } from "@/components/visual/actions-menu";
import { ToneChip } from "@/components/visual/tone-chip";
import { formatBRL } from "@/lib/money";
import { cn } from "@/lib/utils";
import { archiveRecurrenceAction } from "../../server/actions";
import type { FixedRecurrence } from "../../server/queries";
import { AMOUNT_RULE_NOTE, dayText, endsText } from "../../repeat-text";

// No celular: [nome | valor | ⋯] e, embaixo, quando cai e a regra. A partir de @2xl, cinco colunas
// (o bloco do meio vira `contents`), como no canvas.
const ROW =
  "grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-x-3 gap-y-1 py-3 @2xl:grid-cols-[minmax(0,1.3fr)_8rem_minmax(0,1fr)_8.5rem_2.5rem]";
const MIDDLE =
  "text-muted-foreground col-span-3 row-start-2 flex flex-wrap gap-x-2 text-[0.8125rem] @2xl:contents";

const monthShort = new Intl.DateTimeFormat("pt-BR", { month: "short", timeZone: "UTC" });
const shortMonth = (month: string) =>
  `${monthShort.format(new Date(`${month}-15T12:00:00Z`)).replace(".", "")}/${month.slice(0, 4)}`;

export function RecurrenceRow({ r, marked }: { r: FixedRecurrence; marked: boolean }) {
  const where = [
    r.category?.name,
    r.card ? `${r.account.name} ···· ${r.card.lastFour}` : r.account.name,
  ]
    .filter(Boolean)
    .join(" · ");
  const note = r.archivedAt
    ? "encerrada"
    : `${r.origin === "BANK" ? AMOUNT_RULE_NOTE[r.amountRule] : "o FinTrack lança"} · ${endsText(r.endsOn)}`;
  return (
    <li
      data-testid="fixa"
      data-marked={marked || undefined}
      className={cn(ROW, marked && "bg-income/8 -mx-2 rounded-xl px-2")}
    >
      <div className="min-w-0">
        <p className="font-bold break-words">{r.description}</p>
        <p className="text-muted-foreground text-[0.8125rem] break-words">{where}</p>
      </div>
      <div className={MIDDLE}>
        <span className="tabular text-foreground font-mono text-sm">
          {dayText(r.dayRule, r.dayOfMonth)}
        </span>
        <span>{note}</span>
      </div>
      <AmountText cents={r.expected} className="justify-self-end font-bold" />
      <div className="justify-self-end">
        {r.canEdit && !r.archivedAt ? (
          <ActionsMenu label={`Opções de ${r.description}`}>
            <Link href={`/fixas/${r.id}`} className={MENU_ITEM}>
              <Pencil aria-hidden />
              Mudar o valor
            </Link>
            <MenuSeparator />
            <ActionButton
              action={archiveRecurrenceAction}
              fields={{ walletId: r.walletId, recurrenceId: r.id }}
              label={`Parar de repetir ${r.description}`}
              variant="ghost"
              confirm={`Parar de repetir ${r.description}? O que já aconteceu continua.`}
              confirmLabel="Sim, parar"
              className={cn(MENU_ITEM, "text-destructive hover:text-destructive")}
            >
              <Square aria-hidden />
              Parar de repetir
            </ActionButton>
          </ActionsMenu>
        ) : null}
      </div>
    </li>
  );
}

type Installment = {
  key: string;
  title: string;
  bankText: string;
  accountName: string;
  number: number;
  count: number;
  perParcel: bigint;
  remainingCount: number;
  remaining: bigint;
  endsIn: string;
};

export function InstallmentRow({ i }: { i: Installment }) {
  return (
    <li data-testid="parcelada" className={ROW}>
      <div className="min-w-0">
        <p className="font-bold break-words">{i.title}</p>
        <p className="text-muted-foreground text-[0.8125rem] break-words">
          {i.accountName}
          {i.title !== i.bankText ? ` · ${i.bankText}` : ""}
        </p>
      </div>
      <div className={MIDDLE}>
        <span>
          <ToneChip tone={1} icon={Layers}>
            <span className="sr-only">parcela </span>
            {i.number}
            <span aria-hidden>/</span>
            <span className="sr-only"> de </span>
            {i.count}
          </ToneChip>
        </span>
        <span>
          faltam {i.remainingCount} de {formatBRL(i.perParcel)} · termina {shortMonth(i.endsIn)}
        </span>
      </div>
      <div className="flex flex-col items-end">
        <span className="tabular font-mono font-bold">{formatBRL(i.remaining)}</span>
        <span className="text-muted-foreground text-xs">ainda a pagar</span>
      </div>
      <div className="justify-self-end">
        <ActionsMenu label={`Opções de ${i.title}`}>
          <Link href="/cartoes" className={MENU_ITEM}>
            <Wallet aria-hidden />
            Ver nas faturas
          </Link>
        </ActionsMenu>
      </div>
    </li>
  );
}
