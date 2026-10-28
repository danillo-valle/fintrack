import type { Metadata } from "next";
import Link from "next/link";
import { ChartNoAxesColumn } from "lucide-react";
import { EmptyState } from "@/components/feedback/empty-state";
import { PageHeader } from "@/components/layout/page-header";
import { MoneyLink } from "@/components/money/money-link";
import { ChartLegend } from "@/components/visual/chart-legend";
import { budgetQuery, EVOLUTION_SPANS } from "@/features/budget/schemas";
import { getEvolutionPage } from "@/features/budget/server/queries";
import { BudgetTabs } from "@/features/budget/ui/budget-tabs";
import { EnvironmentRow } from "@/features/budget/ui/environment-row";
import {
  CategoryPicker,
  EvolutionChart,
  EvolutionMultiples,
  EvolutionTable,
} from "@/features/budget/ui/evolution";
import { PayerRow } from "@/features/budget/ui/payer-row";
import { ViewToggle } from "@/features/budget/ui/view-toggle";
import { NewTransactionButton } from "@/features/transactions/ui/new-transaction-button";
import { requireUser } from "@/lib/auth/session";
import { formatBRL } from "@/lib/money";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Evolução" };

// Evolução mês a mês por categoria (M08, canvas D): 6, 12 ou 24 meses até o de hoje.
export default async function EvolutionPage({ searchParams }: PageProps<"/orcamento/evolucao">) {
  const session = await requireUser(); // toda página do app começa conferindo a sessão
  const page = await getEvolutionPage(session, await searchParams);
  const { params, selected } = page;
  const here = (extra: Record<string, string | null>) =>
    `/orcamento/evolucao${budgetQuery(params, extra)}`;
  const current = page.lastLabel.split(" ")[0] ?? "";

  const periods = (
    <nav
      aria-label="Período"
      className="bg-muted inline-flex shrink-0 gap-0.5 rounded-xl border p-1"
    >
      {EVOLUTION_SPANS.map((span) => (
        <Link
          key={span}
          href={here({ meses: span === 12 ? null : String(span) })}
          aria-current={params.span === span ? "true" : undefined}
          scroll={false}
          className={cn(
            "focus-visible:ring-ring inline-flex h-9 items-center justify-center rounded-[0.5625rem] px-2.5 text-[0.8125rem] whitespace-nowrap outline-none focus-visible:ring-3 md:px-3.5 md:text-sm",
            params.span === span
              ? "bg-card font-bold shadow-[0_1px_4px_rgb(10_13_40/0.14)]"
              : "text-muted-foreground hover:text-foreground font-semibold",
          )}
        >
          <span>
            {span}
            <span className="md:hidden">{"\u00a0"}m</span>
            <span className="hidden md:inline">{"\u00a0"}meses</span>
          </span>
        </Link>
      ))}
    </nav>
  );

  return (
    <>
      <PageHeader
        help="fluxo-e-evolucao"
        title="Orçamento"
        description={
          <>
            <span className="md:hidden">
              De {page.firstLabel} a {page.lastLabel}
            </span>
            <span className="hidden md:inline">
              Evolução de {page.firstLabel} a {page.lastLabel}
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
        <BudgetTabs current="evolucao" walletId={page.walletId} className="-mt-1 md:-mt-2" />

        <EnvironmentRow
          environments={page.environments}
          current={page.walletId}
          sentence={null}
          hrefFor={(walletId) =>
            `/orcamento/evolucao${budgetQuery({ ...params, walletId, group: null })}`
          }
        >
          <span className="hidden md:block">{periods}</span>
        </EnvironmentRow>

        <PayerRow payers={page.payers} current={params.payer} hrefFor={(pago) => here({ pago })} />

        {selected === null ? (
          <EmptyState
            icon={ChartNoAxesColumn}
            title="Nenhum gasto no período"
            description="Quando houver despesas lançadas, cada categoria aparece aqui mês a mês."
          />
        ) : (
          <>
            <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 md:hidden">
              <CategoryPicker
                current={selected.name}
                currentId={selected.groupId}
                options={page.options}
              />
              {periods}
            </div>

            <section
              id="grafico"
              aria-labelledby="evolucao-titulo"
              className="bg-card flex scroll-mt-20 flex-col gap-2.5 rounded-[1.125rem] border p-3.5 md:gap-3.5 md:rounded-[1.25rem] md:px-[1.375rem] md:py-5"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex flex-col gap-0.5">
                  <h2
                    id="evolucao-titulo"
                    className="text-[1.0625rem] font-extrabold tracking-[-0.01em] md:text-[1.375rem]"
                  >
                    {selected.name}, mês a mês
                  </h2>
                  <span className="text-muted-foreground hidden text-sm md:block">
                    {selected.wallets ? `${selected.wallets} · ` : ""}cada barra leva aos
                    lançamentos daquele mês
                  </span>
                </div>
                <div className="flex gap-2">
                  <CategoryPicker
                    current={selected.name}
                    currentId={selected.groupId}
                    options={page.options}
                    className="hidden md:block"
                  />
                  <ViewToggle
                    current={params.view}
                    hrefFor={(view) => here({ ver: view === "tabela" ? "tabela" : null })}
                  />
                </div>
              </div>

              {params.view === "tabela" ? (
                <EvolutionTable series={selected} />
              ) : (
                <>
                  <ChartLegend
                    items={[
                      { label: "Gasto do mês", shortLabel: "Gasto", mark: "bar" },
                      {
                        label: `Previsto até o fim de ${current}`,
                        shortLabel: "Previsto",
                        mark: "hatch",
                      },
                      { label: "Orçado do mês", shortLabel: "Orçado", mark: "tick" },
                      { label: "Média de 6 meses", shortLabel: "Média 6 meses", mark: "dash" },
                    ]}
                  />
                  <EvolutionChart series={selected} />
                </>
              )}

              <dl className="grid grid-cols-1 gap-3 border-t pt-2 sm:grid-cols-3">
                <div className="flex flex-col text-[0.8125rem]">
                  <dt className="text-muted-foreground">Maior mês</dt>
                  <dd>
                    {page.biggest ? (
                      <Link
                        href={page.biggest.href}
                        className="tabular font-mono text-[1.0625rem] font-bold underline decoration-dotted underline-offset-4 hover:decoration-solid"
                        aria-label={`Maior mês: ${page.biggest.title.toLowerCase()}, ${formatBRL(page.biggest.spent)}. Ver os lançamentos`}
                      >
                        {page.biggest.title.toLowerCase()}, {formatBRL(page.biggest.spent)}
                      </Link>
                    ) : (
                      "—"
                    )}
                  </dd>
                </div>
                <div className="flex flex-col text-[0.8125rem]">
                  <dt className="text-muted-foreground">
                    Média dos {page.closedCount} meses fechados
                  </dt>
                  <dd>
                    {page.closedHref ? (
                      <MoneyLink
                        cents={page.closedAverage}
                        href={page.closedHref}
                        label={`Média dos ${page.closedCount} meses fechados (somam ${formatBRL(page.closedTotal)})`}
                        className="text-[1.0625rem] font-bold"
                      />
                    ) : (
                      "—"
                    )}
                  </dd>
                </div>
                <div className="flex flex-col text-[0.8125rem]">
                  <dt className="text-muted-foreground">Acima do orçado</dt>
                  <dd className="text-[1.0625rem] font-bold">
                    {page.budgetedCount === 0
                      ? "sem orçado no período"
                      : `${page.overCount} de ${page.budgetedCount} ${page.budgetedCount === 1 ? "mês" : "meses"}`}
                  </dd>
                </div>
              </dl>
            </section>

            <section aria-labelledby="todas" className="flex flex-col gap-3">
              <div className="flex flex-wrap items-baseline justify-between gap-3">
                <h2
                  id="todas"
                  className="text-muted-foreground md:text-foreground mx-1 text-[0.8125rem] font-bold md:mx-0 md:text-xl md:font-extrabold md:tracking-[-0.01em]"
                >
                  Todas as categorias
                </h2>
                <span className="text-muted-foreground hidden text-[0.8125rem] md:inline">
                  Cada cartão tem a própria escala. Escolha um para vê-lo no gráfico de cima.
                </span>
              </div>
              <EvolutionMultiples multiples={page.multiples} currentTitle={current} />
            </section>
          </>
        )}
      </div>
    </>
  );
}
