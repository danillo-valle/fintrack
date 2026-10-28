import type { Metadata } from "next";
import { PageHeader } from "@/components/layout/page-header";
import { HighlightCard, StatCard, SummaryGrid } from "@/components/visual/summary";
import { ChartLegend } from "@/components/visual/chart-legend";
import { budgetQuery } from "@/features/budget/schemas";
import { getCashFlowPage } from "@/features/budget/server/queries";
import { BudgetTabs } from "@/features/budget/ui/budget-tabs";
import {
  CASH_LEGEND,
  CashDetail,
  CashFlowCards,
  CashFlowChart,
  CashFlowTable,
  signed,
} from "@/features/budget/ui/cash-flow";
import { EnvironmentRow } from "@/features/budget/ui/environment-row";
import { Panel } from "@/features/budget/ui/home-panels";
import { NewTransactionButton } from "@/features/transactions/ui/new-transaction-button";
import { requireUser } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Fluxo de caixa" };

// Fluxo de caixa (M08, canvas D): os próximos 6 meses, começando no de hoje, só com o que já é
// conhecido. O resultado de cada mês parte de zero (não é saldo de conta).
export default async function CashFlowPage({ searchParams }: PageProps<"/orcamento/fluxo">) {
  const session = await requireUser(); // toda página do app começa conferindo a sessão
  const page = await getCashFlowPage(session, await searchParams);

  return (
    <>
      <PageHeader
        help="fluxo-e-evolucao"
        title="Orçamento"
        description={
          <>
            <span className="md:hidden">
              De {page.firstLabel.split(" ")[0]} a {page.lastLabel.split(" ")[0]}
            </span>
            <span className="hidden md:inline">
              Fluxo de caixa de {page.firstLabel} a {page.lastLabel}
            </span>
          </>
        }
        actions={
          <span className="hidden md:block">
            <NewTransactionButton />
          </span>
        }
      />

      <div className="flex flex-col gap-4 md:gap-5">
        <BudgetTabs current="fluxo" walletId={page.walletId} className="-mt-1 md:-mt-2" />

        <EnvironmentRow
          environments={page.environments}
          current={page.walletId}
          sentence={page.sentence}
          hrefFor={(walletId) => `/orcamento/fluxo${budgetQuery({ walletId })}`}
        />

        <SummaryGrid
          label="Resumo dos 6 meses"
          className="md:grid-cols-[minmax(0,1.4fr)_repeat(2,minmax(0,1fr))]"
        >
          <HighlightCard
            label={`Resultado acumulado até ${page.lastTitle}`}
            data-testid="fluxo-acumulado"
            note="entradas menos saídas previstas, a partir de zero"
          >
            <span className="tabular font-mono" data-cents={page.totals.cumulative.toString()}>
              {signed(page.totals.cumulative)}
            </span>
          </HighlightCard>
          <StatCard
            label="Entradas previstas"
            tone="income"
            className="hidden md:flex"
            note="salário e outras entradas recorrentes"
          >
            <span className="text-income tabular font-mono">{signed(page.totals.income)}</span>
          </StatCard>
          <StatCard
            label="Saídas previstas"
            tone="expense"
            className="hidden md:flex"
            note="fixas, faturas e parcelas agendadas"
          >
            <span className="text-expense tabular font-mono">{signed(-page.totals.out)}</span>
          </StatCard>
        </SummaryGrid>

        <p className="text-muted-foreground md:bg-muted/50 text-[0.8125rem] md:rounded-[0.875rem] md:border md:px-4 md:py-3 md:text-sm">
          <span className="md:hidden">
            Só o que já é conhecido: fixas, entradas recorrentes, faturas e parcelas agendadas.
            Compra no cartão sai no vencimento da fatura.
          </span>
          <span className="hidden md:inline">
            Aqui só entra o que já é conhecido: entradas e despesas fixas, parcelas agendadas e
            faturas com compras já feitas. O gasto variável que ainda não aconteceu fica de fora,
            por isso os meses distantes sobram mais. Compra no cartão sai no vencimento da fatura.
          </span>
        </p>

        <ChartLegend items={CASH_LEGEND} className="md:hidden" />
        <CashFlowCards months={page.flow} />

        <Panel
          id="mes-a-mes"
          title="Mês a mês"
          className="hidden md:flex"
          aside={<ChartLegend items={CASH_LEGEND} />}
        >
          <CashFlowChart months={page.flow} />
          <CashFlowTable months={page.flow} />
        </Panel>

        <CashDetail
          title={page.detail.title}
          rows={page.detail.rows}
          months={page.flow}
          current={page.detail.month}
        />
      </div>
    </>
  );
}
