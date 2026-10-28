import type { Metadata } from "next";
import Link from "next/link";
import { PiggyBank } from "lucide-react";
import { divRound } from "@fintrack/core";
import { EmptyState } from "@/components/feedback/empty-state";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { MonthNav } from "@/components/visual/month-nav";
import { HighlightCard, StatCard, SummaryGrid } from "@/components/visual/summary";
import { budgetQuery } from "@/features/budget/schemas";
import { getBudgetPage } from "@/features/budget/server/queries";
import { BudgetActions } from "@/features/budget/ui/budget-actions";
import { BudgetTable } from "@/features/budget/ui/budget-table";
import { BudgetTabs } from "@/features/budget/ui/budget-tabs";
import { EnvironmentRow } from "@/features/budget/ui/environment-row";
import { PayerRow } from "@/features/budget/ui/payer-row";
import { requireUser } from "@/lib/auth/session";
import { formatBRL } from "@/lib/money";

export const metadata: Metadata = { title: "Orçamento" };

// Orçamento do mês (M08, canvas D "Orçamento da Casa, Mercado dividido por pessoa"): o orçado de
// cada categoria contra o gasto até hoje e o previsto até o fim do mês, com o mês passado, a média
// de 6 meses e a divisão por pessoa. Mês, ambiente e pessoa vão na URL.
export default async function BudgetPage({ searchParams }: PageProps<"/orcamento">) {
  const session = await requireUser(); // toda página do app começa conferindo a sessão
  const page = await getBudgetPage(session, await searchParams);
  const { params, totals } = page;
  const here = (extra: Record<string, string | null>) => `/orcamento${budgetQuery(params, extra)}`;

  const title = page.monthLabel.charAt(0).toUpperCase() + page.monthLabel.slice(1);
  const where = page.walletName ? (
    <>
      Ambiente <strong className="text-foreground">{page.walletName}</strong>
    </>
  ) : (
    "Todos os ambientes que você vê"
  );
  const when =
    page.phase === "current"
      ? `dia ${page.elapsedDays} de ${page.monthDays}`
      : page.phase === "closed"
        ? "mês fechado"
        : "mês que vem";
  const monthNav = {
    label: title,
    prev: { href: page.prevHref, label: page.prevLabel },
    next: { href: page.nextHref, label: page.nextLabel },
  };
  const left = totals.budget - totals.projected;
  const editHref =
    page.editHref ??
    (page.firstEditableWallet
      ? `/orcamento/editar${budgetQuery({ walletId: page.firstEditableWallet.id, month: page.month })}`
      : null);
  const actions = (
    <BudgetActions
      walletId={page.singleWallet}
      month={page.month}
      previousTitle={page.previousTitle}
      editHref={editHref}
    />
  );

  return (
    <>
      <PageHeader
        help="orcamento"
        title="Orçamento"
        description={
          <>
            {where} · {when}
          </>
        }
        actions={<MonthNav {...monthNav} className="hidden md:flex" />}
      />

      <div className="flex flex-col gap-4 md:gap-5">
        <BudgetTabs current="mes" walletId={page.walletId} className="-mt-1 md:-mt-2" />
        <MonthNav {...monthNav} className="md:hidden" />

        <EnvironmentRow
          environments={page.environments}
          current={page.walletId}
          sentence={page.walletId ? null : page.sentence}
          hrefFor={(walletId) => `/orcamento${budgetQuery({ month: page.month, walletId })}`}
        >
          <span className="hidden md:block">{actions}</span>
        </EnvironmentRow>

        <PayerRow payers={page.payers} current={page.payer} hrefFor={(pago) => here({ pago })} />

        {!page.hasWallets ? (
          <EmptyState
            icon={PiggyBank}
            title="Nenhum ambiente ainda"
            description="Crie o seu lar em Carteiras para definir quanto a casa planeja gastar."
            action={
              <Button asChild>
                <Link href="/carteiras">Ir para Carteiras</Link>
              </Button>
            }
          />
        ) : page.rows.length === 0 ? (
          <>
            <EmptyState
              icon={PiggyBank}
              title={`Nenhuma categoria orçada em ${page.monthLabel}`}
              description={
                page.payer
                  ? "Ninguém tem parte do orçado com este filtro. Tire o filtro de pessoa ou divida uma categoria."
                  : page.singleWallet
                    ? `Copie o orçamento de ${page.previousTitle} ou defina o valor de cada categoria.`
                    : "Escolha um ambiente para copiar o mês anterior, ou defina o valor de cada categoria."
              }
            />
            <div className="md:hidden">{actions}</div>
          </>
        ) : (
          <>
            <SummaryGrid
              label="Resumo do orçamento"
              className="md:grid-cols-[minmax(0,1.4fr)_repeat(3,minmax(0,1fr))]"
            >
              <HighlightCard
                label={page.phase === "closed" ? "Gasto no mês" : "Previsto até o fim do mês"}
                data-testid="orcamento-previsto"
                note={
                  <>
                    de <span className="tabular font-mono">{formatBRL(totals.budget)}</span> orçados
                    · {left >= 0n ? `sobra ${formatBRL(left)}` : `passa ${formatBRL(-left)}`}
                  </>
                }
              >
                <span className="tabular font-mono" data-cents={totals.projected.toString()}>
                  {formatBRL(totals.projected)}
                </span>
              </HighlightCard>
              <StatCard
                label="Gasto até hoje"
                tone="expense"
                className="hidden md:flex"
                note={
                  totals.budget > 0n
                    ? `${divRound(totals.spent * 100n, totals.budget)} % do orçado`
                    : undefined
                }
              >
                <span className="text-expense tabular font-mono">{formatBRL(totals.spent)}</span>
              </StatCard>
              <StatCard
                label="Orçado"
                className="hidden md:flex"
                note={page.rows.length === 1 ? "1 categoria" : `${page.rows.length} categorias`}
              >
                <span className="tabular font-mono">{formatBRL(totals.budget)}</span>
              </StatCard>
              <StatCard
                label="Acima do ritmo"
                className="hidden md:flex"
                note={
                  page.overFirst
                    ? `${page.overFirst.name}: + ${formatBRL(page.overFirst.by)}`
                    : "nenhuma categoria"
                }
              >
                <span className={page.overCount > 0 ? "text-expense" : undefined}>
                  {page.overCount === 1 ? "1 categoria" : `${page.overCount} categorias`}
                </span>
              </StatCard>
            </SummaryGrid>

            <div className="md:hidden">{actions}</div>

            <BudgetTable
              rows={page.rows}
              totals={totals}
              showWallet={page.walletId === null}
              payerFiltered={page.payer !== null}
              canEditSomething={page.firstEditableWallet !== null}
            />

            <p className="text-muted-foreground text-[0.8125rem]">
              Cada valor de uma linha leva aos lançamentos que o compõem. Os totais somam categorias
              diferentes e não têm uma lista só: abra a linha de cada uma.
            </p>

            <details className="bg-card rounded-2xl border px-[1.125rem] py-3.5 text-sm">
              <summary className="cursor-pointer font-bold">Como o previsto é calculado</summary>
              <p className="text-muted-foreground mt-2.5">
                {page.phase === "closed"
                  ? "O mês já acabou: o previsto é o que foi gasto."
                  : page.phase === "future"
                    ? "O mês ainda não começou: entram só as despesas fixas e as parcelas agendadas, pelo valor previsto."
                    : `Despesas fixas e parcelas do mês entram pelo valor previsto. O gasto variável segue o ritmo de ${page.monthLabel.split(" ")[0]}: o que já foi gasto, dividido pelos ${page.elapsedDays} dias passados, vezes os ${page.monthDays} dias do mês.`}
              </p>
            </details>
          </>
        )}
      </div>
    </>
  );
}
