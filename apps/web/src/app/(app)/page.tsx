import type { Metadata } from "next";
import Link from "next/link";
import { ReceiptText } from "lucide-react";
import { EmptyState } from "@/components/feedback/empty-state";
import { PageHeader } from "@/components/layout/page-header";
import { MoneyLink } from "@/components/money/money-link";
import { Button } from "@/components/ui/button";
import { HighlightCard, StatCard, SummaryGrid } from "@/components/visual/summary";
import { budgetQuery } from "@/features/budget/schemas";
import { getHomeDashboard } from "@/features/budget/server/queries";
import { EnvironmentRow } from "@/features/budget/ui/environment-row";
import { GroupSpendingChart, GroupSpendingTable } from "@/features/budget/ui/group-spending";
import { BudgetAlerts, CashFlowMini, Panel } from "@/features/budget/ui/home-panels";
import { MonthSummary } from "@/features/budget/ui/month-summary";
import { ViewToggle } from "@/features/budget/ui/view-toggle";
import { getBankHome } from "@/features/bank/server/queries";
import { BankAccountCards } from "@/features/bank/ui/bank-accounts";
import { ReceivedBanner } from "@/features/bank/ui/received-banner";
import { SyncLine } from "@/features/bank/ui/sync-line";
import { NewTransactionButton } from "@/features/transactions/ui/new-transaction-button";
import { requireUser } from "@/lib/auth/session";
import { formatBRL } from "@/lib/money";
import { NUMBER_LINK } from "@/lib/styles";
import { cn } from "@/lib/utils";

// Título da aba igual ao h1, como nas outras páginas: "Início · FinTrack" (WCAG 2.4.2)
export const metadata: Metadata = { title: "Início" };

// Início (M08, canvas D "Início: orçamento, gasto por categoria e fluxo"): como estamos este mês.
// O previsto de fim de mês, o gasto até hoje, o orçado e as entradas; o gasto por categoria contra
// o mês passado e a média de 6 meses; as categorias acima do ritmo; e o resultado dos próximos 6
// meses. Todo número leva aos lançamentos que o compõem.
export default async function HomePage({ searchParams }: PageProps<"/">) {
  // Toda página do app começa conferindo a sessão (skill auth-guard)
  const session = await requireUser();
  const home = await getHomeDashboard(session, await searchParams);
  // M09.1: contas e cartões do banco no mesmo recorte de ambiente (nulo sem conexão nenhuma)
  const bank = home.hasWallets ? await getBankHome(session, home.walletId) : null;
  const { summary } = home;
  const here = (extra: Record<string, string | null>) =>
    `/${budgetQuery({ walletId: home.walletId, view: home.view }, extra)}`;

  if (!home.hasWallets) {
    return (
      <>
        <PageHeader
          help="inicio"
          title="Início"
          description={`Olá, ${session.user.name.split(" ")[0] ?? session.user.name}. Como estamos este mês.`}
        />
        <EmptyState
          icon={ReceiptText}
          title="Nenhum lançamento ainda"
          description="Crie o seu lar em Carteiras para começar a lançar e ver o resumo do mês aqui."
          action={
            <Button asChild>
              <Link href="/carteiras">Ir para Carteiras</Link>
            </Button>
          }
        />
      </>
    );
  }

  const left =
    summary.status.kind === "within"
      ? `sobra ${formatBRL(summary.status.left)}`
      : summary.status.kind === "over"
        ? `passa ${formatBRL(summary.status.by)}`
        : null;
  const sideLink = cn(NUMBER_LINK, "text-chart-1-ink text-sm font-semibold");

  return (
    <>
      <PageHeader
        help="inicio"
        title="Início"
        description={`${home.todayLabel.charAt(0).toUpperCase()}${home.todayLabel.slice(1)} · dia ${home.elapsedDays} de ${home.monthDays}`}
        actions={<NewTransactionButton />}
      />

      <div className="flex flex-col gap-5">
        <EnvironmentRow
          environments={home.environments}
          current={home.walletId}
          sentence={home.sentence}
          hrefFor={(walletId) => `/${budgetQuery({ walletId, view: home.view })}`}
        />

        {/* M10.3: o resumo do mês, logo abaixo do ambiente (linha F.3 do canvas) */}
        <MonthSummary summary={home.summaryOfMonth} />

        {bank && bank.accounts.length > 0 ? (
          <section aria-labelledby="contas-e-cartoes" className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2
                id="contas-e-cartoes"
                className="text-[1.0625rem] font-extrabold tracking-[-0.01em] md:text-xl"
              >
                Contas e cartões
              </h2>
              <SyncLine
                bankUpdatedAt={bank.bankUpdatedAt}
                lastSyncedAt={bank.lastSyncedAt}
                canSync={bank.canSync}
              />
            </div>
            <BankAccountCards accounts={bank.accounts} />
          </section>
        ) : null}
        {bank ? (
          <ReceivedBanner count={bank.received.count} uncategorized={bank.received.uncategorized} />
        ) : null}

        <SummaryGrid
          // M10.3: "Resumo de outubro" agora é o resumo em observações; este é o dos números
          label={`Números de ${home.monthLabel}`}
          className="md:grid-cols-[minmax(0,1.4fr)_repeat(3,minmax(0,1fr))]"
        >
          <HighlightCard
            label="Saídas previstas até o fim do mês"
            data-testid="inicio-previsto"
            note={
              summary.budgetCount > 0 ? (
                <>
                  de{" "}
                  <Link href={summary.budget.href} className={cn(NUMBER_LINK, "tabular font-mono")}>
                    {formatBRL(summary.budget.cents)}
                  </Link>{" "}
                  orçados{left ? ` · ${left}` : ""}
                </>
              ) : (
                <>
                  Sem orçamento neste mês.{" "}
                  <Link href={summary.budget.href} className={NUMBER_LINK}>
                    Definir
                  </Link>
                </>
              )
            }
          >
            <MoneyLink
              cents={summary.projected.cents}
              href={summary.projected.href}
              label="Saídas previstas até o fim do mês"
            />
          </HighlightCard>
          <StatCard
            label="Gasto até hoje"
            tone="expense"
            data-testid="inicio-gasto"
            note={
              <span className="hidden md:inline">
                {bank && bank.received.count > 0
                  ? "só lançamentos confirmados"
                  : "variáveis, fixas e parcelas"}
              </span>
            }
          >
            <MoneyLink
              cents={summary.spent.cents}
              href={summary.spent.href}
              label="Gasto até hoje"
              className="text-expense"
            />
          </StatCard>
          <StatCard
            label="Orçado no mês"
            className="hidden md:flex"
            note={summary.budgetCount === 1 ? "1 categoria" : `${summary.budgetCount} categorias`}
          >
            <Link
              href={summary.budget.href}
              className={cn(NUMBER_LINK, "tabular font-mono")}
              data-testid="inicio-orcado"
            >
              {formatBRL(summary.budget.cents)}
            </Link>
          </StatCard>
          <StatCard
            label="Entradas"
            tone="income"
            data-testid="inicio-entradas"
            note={<span className="hidden md:inline">até hoje</span>}
          >
            <MoneyLink
              cents={summary.income.cents}
              href={summary.income.href}
              label="Entradas até hoje"
              sign="+"
              className="text-income"
            />
          </StatCard>
        </SummaryGrid>

        {home.alerts.length > 0 ? (
          <section aria-labelledby="atencao" className="flex flex-col gap-2 md:hidden">
            <h2 id="atencao" className="text-muted-foreground mx-1 text-[0.8125rem] font-bold">
              Atenção
            </h2>
            <BudgetAlerts
              alerts={home.alerts}
              withinCount={home.withinCount}
              budgetHref={summary.budget.href}
              compact
            />
          </section>
        ) : null}

        <div className="grid items-start gap-4 md:grid-cols-[minmax(0,1.65fr)_minmax(0,1fr)]">
          <Panel
            id="gasto-por-categoria"
            title="Gasto por categoria"
            aside={
              <ViewToggle
                current={home.view}
                hrefFor={(view) => here({ ver: view === "tabela" ? "tabela" : null })}
              />
            }
          >
            {home.groups.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                Nenhum gasto neste mês nem nos 6 anteriores.
              </p>
            ) : home.view === "tabela" ? (
              <GroupSpendingTable groups={home.groups} />
            ) : (
              <GroupSpendingChart
                groups={home.groups}
                allHref={`/orcamento/evolucao${budgetQuery({ walletId: home.walletId })}#todas`}
              />
            )}
            <p className="text-muted-foreground text-[0.8125rem]">
              Clique numa categoria para ver a evolução mês a mês; num valor, para ver os
              lançamentos que o compõem. A aba Tabela mostra os mesmos números, com o mês passado e
              a média de 6 meses escritos.
            </p>
          </Panel>

          <div className="flex flex-col gap-4">
            <Panel
              id="orcado-realizado"
              title="Orçado × realizado"
              className="hidden md:flex"
              aside={
                <Link href={summary.budget.href} className={sideLink}>
                  Orçamento
                </Link>
              }
            >
              {summary.budgetCount === 0 ? (
                <p className="text-muted-foreground text-sm">
                  Nenhuma categoria com orçado neste mês.{" "}
                  <Link href={summary.budget.href} className={NUMBER_LINK}>
                    Definir o orçamento
                  </Link>
                </p>
              ) : (
                <BudgetAlerts
                  alerts={home.alerts}
                  withinCount={home.withinCount}
                  budgetHref={summary.budget.href}
                />
              )}
            </Panel>
            <Panel
              id="fluxo"
              title="Fluxo de caixa"
              aside={
                <Link
                  href={`/orcamento/fluxo${budgetQuery({ walletId: home.walletId })}`}
                  className={sideLink}
                >
                  6 meses
                </Link>
              }
            >
              <p className="text-muted-foreground -mt-1 hidden text-[0.8125rem] md:block">
                Resultado de cada mês, só com o que já está previsto
              </p>
              <div className="hidden md:block">
                <CashFlowMini months={home.cashflow} />
              </div>
              <div className="md:hidden">
                <CashFlowMini months={home.cashflow} limit={3} />
              </div>
            </Panel>
          </div>
        </div>
      </div>
    </>
  );
}
