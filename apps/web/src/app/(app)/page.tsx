import type { Metadata } from "next";
import Link from "next/link";
import { ReceiptText } from "lucide-react";
import { EmptyState } from "@/components/feedback/empty-state";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { budgetQuery } from "@/features/budget/schemas";
import { getHomeDashboard } from "@/features/budget/server/queries";
import { EnvironmentRow } from "@/features/budget/ui/environment-row";
import { ForecastBlock } from "@/features/budget/ui/forecast-block";
import { GroupSpendingChart, GroupSpendingTable } from "@/features/budget/ui/group-spending";
import { BudgetAlerts, CashFlowMini, Panel } from "@/features/budget/ui/home-panels";
import { MonthResult } from "@/features/budget/ui/month-result";
import { MonthSummary } from "@/features/budget/ui/month-summary";
import { ViewToggle } from "@/features/budget/ui/view-toggle";
import { getBankHome } from "@/features/bank/server/queries";
import { BillsToPay, MoneyNow } from "@/features/bank/ui/home-money";
import { ReceivedBanner } from "@/features/bank/ui/received-banner";
import { SyncLine } from "@/features/bank/ui/sync-line";
import { NewTransactionButton } from "@/features/transactions/ui/new-transaction-button";
import { requireUser } from "@/lib/auth/session";
import { formatBRL } from "@/lib/money";
import { NUMBER_LINK } from "@/lib/styles";
import { cn } from "@/lib/utils";

// Título da aba igual ao h1, como nas outras páginas: "Início · FinTrack" (WCAG 2.4.2)
export const metadata: Metadata = { title: "Início" };

// Início (M08, canvas D; o dinheiro de verdade no M13.3a, prancha N-Inicio): como estamos este mês.
// O resultado do mês (cada compra uma vez, no cartão pelo vencimento da fatura), o que está nas
// contas, o guardado e as faturas a pagar; o previsto de fim de mês em três partes (M13.3b) e o orçado; o gasto por
// categoria contra o mês passado e a média de 6 meses; as categorias acima do ritmo; e o resultado
// dos próximos 6 meses. Todo número leva aos lançamentos que o compõem.
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
  const sync = bank ? (
    <SyncLine
      bankUpdatedAt={bank.bankUpdatedAt}
      lastSyncedAt={bank.lastSyncedAt}
      canSync={bank.canSync}
    />
  ) : null;

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

        {/* M13.3a (ADR-025, prancha N-Inicio): o resultado do mês, uma vez cada compra */}
        <MonthResult
          monthLabel={home.monthName}
          elapsedDays={home.elapsedDays}
          result={home.result}
          received={bank?.received.count ?? 0}
        />

        {/* O dinheiro de verdade: as contas, a poupança e as faturas, como o banco mostra */}
        {bank ? (
          <>
            <MoneyNow bank={bank} aside={sync} />
            <BillsToPay
              bank={bank}
              aside={bank.checking.length === 0 && bank.savings.length === 0 ? sync : undefined}
            />
            <ReceivedBanner
              count={bank.received.count}
              uncategorized={bank.received.uncategorized}
            />
          </>
        ) : null}

        {/* M13.3b (ADR-026): o previsto em três partes; as fixas e as parcelas uma vez cada */}
        <ForecastBlock
          monthLabel={home.monthName}
          elapsedDays={home.elapsedDays}
          monthDays={home.monthDays}
          total={summary.projected}
          forecast={home.forecast}
          budget={{
            cents: summary.budget.cents,
            href: summary.budget.href,
            count: summary.budgetCount,
            left,
          }}
        />

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
