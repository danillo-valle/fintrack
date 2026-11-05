import type { Metadata } from "next";
import Link from "next/link";
import { Check, Layers, Plus, Repeat, TrendingUp, X } from "lucide-react";
import { ActionButton } from "@/components/feedback/action-button";
import { EmptyState } from "@/components/feedback/empty-state";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { SegmentedNav } from "@/components/visual/segmented-nav";
import { generateRecurrencesAction } from "@/features/transactions/server/actions";
import {
  getFixedPage,
  type FixedRecurrence,
  type FixedTab,
} from "@/features/transactions/server/queries";
import { monthName } from "@/features/transactions/presentation";
import { entryTabHref } from "@/features/transactions/ui/entry/entry-tabs";
import { InstallmentRow, RecurrenceRow } from "@/features/transactions/ui/repeat/fixed-rows";
import { requireUser } from "@/lib/auth/session";
import { formatBRL } from "@/lib/money";

export const metadata: Metadata = { title: "Fixas e parcelas" };

const SECTION = "bg-card flex flex-col gap-3 rounded-[1.25rem] border p-4 md:p-5 @container";
const H2 = "text-[1.0625rem] font-extrabold tracking-[-0.01em] md:text-xl";

const TABS: { tab: FixedTab | null; label: string; icon?: typeof Repeat }[] = [
  { tab: null, label: "Tudo" },
  { tab: "entradas", label: "Entradas", icon: TrendingUp },
  { tab: "saidas", label: "Saídas fixas", icon: Repeat },
  { tab: "parceladas", label: "Parceladas", icon: Layers },
];

const tabHref = (tab: FixedTab | null) => (tab ? `/fixas?mostrar=${tab}` : "/fixas");

// Fixas e parcelas (M13.3a, item do menu; M13.3c, prancha O-Fixas): as entradas e saídas que se
// repetem todo mês, com o valor previsto pela regra de cada uma, e as compras parceladas em
// andamento, com o que ainda falta pagar. A fixa que chega do banco entra aqui sozinha (ADR-027);
// o "⋯" muda o valor ou para de repetir. Ajustes fica só com configuração; esta é uma visão.
export default async function FixedPage({ searchParams }: PageProps<"/fixas">) {
  const session = await requireUser(); // toda página do app começa conferindo a sessão
  const page = await getFixedPage(session, await searchParams);
  const month = page.today.slice(0, 7);
  const active = (list: FixedRecurrence[]) => list.filter((r) => !r.archivedAt);
  const monthly = (list: FixedRecurrence[]) =>
    active(list).reduce((sum, r) => sum + (r.expected < 0n ? -r.expected : r.expected), 0n);
  const toPay = page.installments.reduce((sum, i) => sum + i.remaining, 0n);
  const shows = (tab: FixedTab) => page.tab === null || page.tab === tab;

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
      {page.changed ? (
        <div
          role="status"
          data-testid="aviso-criado"
          className="bg-income/12 mb-5 flex items-center gap-3 rounded-2xl p-3.5 md:p-4"
        >
          <span className="bg-card text-income flex size-9 shrink-0 items-center justify-center rounded-xl">
            <Check aria-hidden className="size-5" />
          </span>
          <p className="min-w-0 flex-1 text-[0.9375rem] leading-snug">
            <strong>{page.changed.name}</strong> mudou. O previsto dos próximos meses já usa o valor
            e o dia novos.
          </p>
          <Button asChild variant="ghost" size="icon" className="size-11 shrink-0 rounded-xl">
            <Link href={tabHref(page.tab)} aria-label="Fechar o aviso">
              <X aria-hidden />
            </Link>
          </Button>
        </div>
      ) : null}
      <div className="flex flex-col gap-5">
        <SegmentedNav
          label="Mostrar"
          items={TABS.map(({ tab, label, icon }) => ({
            href: tabHref(tab),
            label,
            icon,
            active: page.tab === tab,
          }))}
        />

        {shows("entradas") ? (
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
                Nenhuma entrada fixa. Quando o salário chegar do banco, abra o lançamento e escolha
                Tipo da receita: Fixa.
              </p>
            ) : (
              <ul className="divide-y">
                {page.income.map((r) => (
                  <RecurrenceRow key={r.id} r={r} marked={page.changed?.id === r.id} />
                ))}
              </ul>
            )}
          </section>
        ) : null}

        {shows("saidas") ? (
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
                description="A fixa que chega do banco entra aqui sozinha. Aluguel e escola sem banco: a aba Recorrência do Novo lançamento."
              />
            ) : (
              <ul className="divide-y">
                {page.expense.map((r) => (
                  <RecurrenceRow key={r.id} r={r} marked={page.changed?.id === r.id} />
                ))}
              </ul>
            )}
            <div className="flex flex-wrap items-center gap-3 border-t pt-3">
              <ActionButton action={generateRecurrencesAction} fields={{ month }} variant="outline">
                <Repeat aria-hidden />
                Lançar as deste mês
              </ActionButton>
              <span className="text-muted-foreground text-sm">
                Cria, agendado, o lançamento de {monthName(month).toLowerCase()} de cada fixa que o
                FinTrack lança (sem repetir o que já existe).
              </span>
            </div>
          </section>
        ) : null}

        {shows("parceladas") ? (
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
              <p className="text-muted-foreground text-sm">
                Nenhuma compra parcelada em andamento.
              </p>
            ) : (
              <ul className="divide-y">
                {page.installments.map((i) => (
                  <InstallmentRow key={i.key} i={i} />
                ))}
              </ul>
            )}
            <p className="text-muted-foreground border-t pt-3 text-sm">
              As parcelas que faltam estão previstas nas faturas. A parcelada some daqui quando a
              última chega do banco.
            </p>
          </section>
        ) : null}
      </div>
    </>
  );
}
