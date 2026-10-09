import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeftRight, Download, ReceiptText, Repeat } from "lucide-react";
import { EmptyState } from "@/components/feedback/empty-state";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { ActionBar, ActionBarLink } from "@/components/visual/action-bar";
import { ChipLink } from "@/components/visual/chip";
import { ListToolbar } from "@/components/visual/list-toolbar";
import { getTransactionsPage } from "@/features/transactions/server/queries";
import { filtersToQuery } from "@/features/transactions/schemas";
import { periodPresets } from "@/features/transactions/presentation";
import { activeFilterCount, TransactionFiltersForm } from "@/features/transactions/ui/filters";
import { NewTransactionButton } from "@/features/transactions/ui/new-transaction-button";
import { TotalsSummary } from "@/features/transactions/ui/totals-summary";
import { TransactionList } from "@/features/transactions/ui/transaction-list";
import { requireUser } from "@/lib/auth/session";
import { formatDate, todayISO } from "@/lib/dates";
import { TEXT_LINK } from "@/lib/styles";

export const metadata: Metadata = { title: "Lançamentos" };

const day = (date: string) => formatDate(new Date(`${date}T12:00:00Z`));

// Lista de lançamentos (M07; visual do M07.3, opção B do canvas): resumo do filtro no topo
// (calculado no banco, com o MESMO filtro da lista), chips de período, barra de ações e o painel
// de filtros, e a lista agrupada por dia. Filtros na URL e paginação por cursor. Mostra só os
// ambientes que a pessoa vê.
export default async function TransactionsPage({ searchParams }: PageProps<"/lancamentos">) {
  const session = await requireUser(); // toda página do app começa conferindo a sessão
  const page = await getTransactionsPage(session, await searchParams);
  const { parsed, totals } = page;
  const period = `${day(parsed.filters.from)} a ${day(parsed.filters.to)}`;
  const today = todayISO();
  const presets = periodPresets(today);

  return (
    <>
      <PageHeader title="Lançamentos" description={period} actions={<NewTransactionButton />} />

      <TotalsSummary
        totals={totals}
        label="Totais do filtro"
        balanceLabel="Saldo do período"
        testIdPrefix="total"
      />
      <p className="text-muted-foreground mt-2 mb-5 px-1 text-[0.8125rem]">
        {totals.count} {totals.count === 1 ? "lançamento" : "lançamentos"} no filtro. Transferências
        aparecem na lista, mas não entram nas entradas e saídas.
      </p>

      <ListToolbar
        className="mb-6"
        activeCount={activeFilterCount(parsed)}
        chipsLabel="Período"
        chips={presets.map((p) => (
          // Atalhos de período: mudam só as datas e mantêm os outros filtros
          <ChipLink
            key={p.label}
            href={`/lancamentos?${filtersToQuery(parsed, { de: p.from, ate: p.to, cursor: null })}`}
            active={parsed.filters.from === p.from && parsed.filters.to === p.to}
          >
            {p.label}
          </ChipLink>
        ))}
        actions={
          <ActionBar label="Mais ações de lançamento">
            <ActionBarLink href="/lancamentos/transferencia" icon={ArrowLeftRight} tone={1}>
              Transferência
            </ActionBarLink>
            <ActionBarLink href="/lancamentos/recorrencias" icon={Repeat} tone={4}>
              Recorrências
            </ActionBarLink>
            {page.canExport ? (
              <ActionBarLink
                href={`/lancamentos/exportar?${filtersToQuery(parsed)}`}
                icon={Download}
                tone={5}
              >
                <span>
                  <span className="sr-only">Exportar </span>CSV
                </span>
              </ActionBarLink>
            ) : null}
          </ActionBar>
        }
        panel={<TransactionFiltersForm parsed={parsed} options={page.options} />}
      />

      {page.items.length === 0 ? (
        <EmptyState
          icon={ReceiptText}
          title={parsed.cursor ? "Não há mais lançamentos" : "Nenhum lançamento neste filtro"}
          description={
            page.hasWallets
              ? "Mude o período ou os filtros, ou registre um lançamento novo."
              : "Crie o seu lar em Carteiras para começar a lançar."
          }
          action={
            <Button asChild>
              <Link href={page.hasWallets ? "/lancamentos/novo" : "/carteiras"}>
                {page.hasWallets ? "Registrar lançamento" : "Ir para Carteiras"}
              </Link>
            </Button>
          }
        />
      ) : (
        <TransactionList items={page.items} today={today} />
      )}

      <nav aria-label="Páginas" className="mt-6 flex flex-wrap gap-4 text-sm">
        {parsed.cursor ? (
          <Link href={`/lancamentos?${filtersToQuery(parsed)}`} className={TEXT_LINK}>
            Voltar aos mais recentes
          </Link>
        ) : null}
        {page.nextCursor ? (
          <Link
            href={`/lancamentos?${filtersToQuery(parsed, { cursor: page.nextCursor })}`}
            className={TEXT_LINK}
          >
            Ver mais antigos
          </Link>
        ) : null}
      </nav>
    </>
  );
}
