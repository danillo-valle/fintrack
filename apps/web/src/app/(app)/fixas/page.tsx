import type { Metadata } from "next";
import Link from "next/link";
import { Plus, Repeat } from "lucide-react";
import { ActionButton } from "@/components/feedback/action-button";
import { EmptyState } from "@/components/feedback/empty-state";
import { PageHeader } from "@/components/layout/page-header";
import { AmountText } from "@/components/money/amount-text";
import { Button } from "@/components/ui/button";
import {
  archiveRecurrenceAction,
  generateRecurrencesAction,
} from "@/features/transactions/server/actions";
import { getFixedPage } from "@/features/transactions/server/queries";
import { monthName } from "@/features/transactions/presentation";
import { entryTabHref } from "@/features/transactions/ui/entry/entry-tabs";
import { requireUser } from "@/lib/auth/session";
import { RECURRENCE_KIND_LABEL } from "@/lib/labels";
import { formatBRL } from "@/lib/money";

export const metadata: Metadata = { title: "Fixas e parcelas" };

const SECTION = "bg-card flex flex-col gap-3 rounded-[1.25rem] border p-4 md:p-5";
const H2 = "text-[1.0625rem] font-extrabold tracking-[-0.01em] md:text-xl";
const shortMonth = (month: string) =>
  `${monthName(month).slice(0, 3).toLowerCase()}/${month.slice(0, 4)}`;

type Recurrence = Awaited<ReturnType<typeof getFixedPage>>["expense"][number];

function RecurrenceRow({ r }: { r: Recurrence }) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 py-3">
      <div className="min-w-0">
        <p className="font-semibold break-words">
          {r.description}
          {r.archivedAt ? <span className="text-muted-foreground"> (encerrada)</span> : null}
        </p>
        <p className="text-muted-foreground text-sm break-words">
          {RECURRENCE_KIND_LABEL[r.kind]} · todo dia {r.dayOfMonth} · {r.account.name}
          {r.category ? ` · ${r.category.name}` : ""} ·{" "}
          {r.endsOn ? `até ${shortMonth(r.endsOn.slice(0, 7))}` : "sem fim"}
        </p>
      </div>
      <div className="flex items-center gap-3">
        <AmountText cents={r.amount} className="font-bold" />
        {r.canEdit && !r.archivedAt ? (
          <ActionButton
            action={archiveRecurrenceAction}
            fields={{ walletId: r.walletId, recurrenceId: r.id }}
            label={`Parar de repetir ${r.description}`}
            confirm={`Parar de repetir ${r.description}? O que já aconteceu continua.`}
            confirmLabel="Sim, parar"
          >
            Parar de repetir
          </ActionButton>
        ) : null}
      </div>
    </li>
  );
}

// Fixas e parcelas (M13.3a, item do menu; prancha O-Fixas): as entradas e saídas que se repetem
// todo mês e as compras parceladas em andamento, com o que ainda falta pagar. Ajustes fica só com
// configuração; esta é uma visão. A nova fixa é a aba Recorrência do Novo lançamento.
export default async function FixedPage() {
  const session = await requireUser(); // toda página do app começa conferindo a sessão
  const page = await getFixedPage(session);
  const month = page.today.slice(0, 7);
  const active = (list: Recurrence[]) => list.filter((r) => !r.archivedAt);
  const monthly = (list: Recurrence[]) =>
    active(list).reduce((sum, r) => sum + (r.amount < 0n ? -r.amount : r.amount), 0n);
  const toPay = page.installments.reduce((sum, i) => sum + i.remaining, 0n);

  return (
    <>
      <PageHeader
        help="parcelada-e-fixa"
        title="Fixas e parcelas"
        description="O que se repete e o que ainda vai ser cobrado"
        actions={
          page.canCreate ? (
            <Button asChild size="lg" className="hidden h-11 rounded-xl font-bold md:inline-flex">
              <Link href={entryTabHref("recorrencia")}>
                <Plus aria-hidden />
                Nova fixa
              </Link>
            </Button>
          ) : null
        }
      />
      <div className="flex flex-col gap-5">
        <section aria-labelledby="entradas-fixas" className={SECTION}>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="entradas-fixas" className={H2}>
              Entradas fixas
            </h2>
            <span className="text-muted-foreground tabular font-mono text-sm">
              {formatBRL(monthly(page.income))} por mês
            </span>
          </div>
          {page.income.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              Nenhuma entrada fixa. O salário entra pela aba Recorrência do Novo lançamento, como
              Entrada.
            </p>
          ) : (
            <ul className="divide-y">
              {page.income.map((r) => (
                <RecurrenceRow key={r.id} r={r} />
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="saidas-fixas" className={SECTION}>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="saidas-fixas" className={H2}>
              Saídas fixas
            </h2>
            <span className="text-muted-foreground tabular font-mono text-sm">
              {active(page.expense).length} · {formatBRL(monthly(page.expense))} por mês
            </span>
          </div>
          {page.expense.length === 0 ? (
            <EmptyState
              icon={Repeat}
              title="Nenhuma saída fixa"
              description="Aluguel, escola, assinaturas: cadastre pela aba Recorrência do Novo lançamento."
            />
          ) : (
            <ul className="divide-y">
              {page.expense.map((r) => (
                <RecurrenceRow key={r.id} r={r} />
              ))}
            </ul>
          )}
          <div className="flex flex-wrap items-center gap-3 border-t pt-3">
            <ActionButton action={generateRecurrencesAction} fields={{ month }} variant="outline">
              <Repeat aria-hidden />
              Lançar as deste mês
            </ActionButton>
            <span className="text-muted-foreground text-sm">
              Cria, agendado, o lançamento de {monthName(month).toLowerCase()} de cada fixa (sem
              repetir o que já existe).
            </span>
          </div>
        </section>

        <section aria-labelledby="parceladas" className={SECTION}>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="parceladas" className={H2}>
              Parceladas em andamento
            </h2>
            <span className="text-muted-foreground tabular font-mono text-sm">
              {page.installments.length} · {formatBRL(toPay)} ainda a pagar
            </span>
          </div>
          {page.installments.length === 0 ? (
            <p className="text-muted-foreground text-sm">Nenhuma compra parcelada em andamento.</p>
          ) : (
            <ul className="divide-y">
              {page.installments.map((i) => (
                <li key={i.key} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 font-semibold break-words">
                      {i.title}
                      <span className="text-muted-foreground shrink-0 rounded-md border px-1.5 text-xs font-semibold tabular-nums">
                        <span className="sr-only">parcela </span>
                        {i.number}
                        <span aria-hidden>/</span>
                        <span className="sr-only"> de </span>
                        {i.count}
                      </span>
                    </p>
                    <p className="text-muted-foreground text-sm break-words">
                      {i.accountName}
                      {i.title !== i.bankText ? ` · ${i.bankText}` : ""} · faltam {i.remainingCount}{" "}
                      de {formatBRL(i.perParcel)} · termina {shortMonth(i.endsIn)}
                    </p>
                  </div>
                  <span className="flex flex-col items-end">
                    <span className="tabular font-mono font-bold">{formatBRL(i.remaining)}</span>
                    <span className="text-muted-foreground text-xs">ainda a pagar</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
          <p className="text-muted-foreground border-t pt-3 text-sm">
            A parcela de agora é a da próxima fatura. A parcelada some daqui quando a última parcela
            chega.
          </p>
        </section>
      </div>
    </>
  );
}
