import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeftRight, Download, Plus, ReceiptText, Repeat } from "lucide-react";
import { EmptyState } from "@/components/feedback/empty-state";
import { PageHeader } from "@/components/layout/page-header";
import { AmountText } from "@/components/money/amount-text";
import { ChipLink } from "@/components/visual/chip";
import { HeroPanel, HeroStat } from "@/components/visual/hero-panel";
import { Button } from "@/components/ui/button";
import { getTransactionsPage } from "@/features/transactions/server/queries";
import { filtersToQuery } from "@/features/transactions/schemas";
import { periodPresets } from "@/features/transactions/presentation";
import { TransactionFilters } from "@/features/transactions/ui/filters";
import { TransactionList } from "@/features/transactions/ui/transaction-list";
import { requireUser } from "@/lib/auth/session";
import { formatDate, todayISO } from "@/lib/dates";
import { TEXT_LINK } from "@/lib/styles";

export const metadata: Metadata = { title: "Lançamentos" };

const day = (date: string) => formatDate(new Date(`${date}T12:00:00Z`));

// Lista de lançamentos (M07): filtros na URL, totais do filtro no topo (calculados no banco,
// com o MESMO filtro da lista) e paginação por cursor. Mostra só as carteiras que a pessoa vê.
export default async function TransactionsPage({ searchParams }: PageProps<"/lancamentos">) {
  const session = await requireUser(); // toda página do app começa conferindo a sessão
  const page = await getTransactionsPage(session, await searchParams);
  const { parsed, totals } = page;
  const period = `${day(parsed.filters.from)} a ${day(parsed.filters.to)}`;
  const today = todayISO();
  const presets = periodPresets(today);

  return (
    <>
      <PageHeader
        title="Lançamentos"
        description={period}
        actions={
          <Button asChild className="hidden md:inline-flex">
            <Link href="/lancamentos/novo">
              <Plus aria-hidden />
              Novo lançamento
            </Link>
          </Button>
        }
      />

      {/* O painel elétrico: o único destaque da página (ADR-008). Totais calculados no banco,
          com o MESMO filtro da lista. */}
      <HeroPanel labelledBy="totais" className="mb-5">
        <h2 id="totais" className="sr-only">
          Totais do filtro
        </h2>
        <div data-testid="total-saldo">
          <p className="text-sm opacity-90">Saldo do período</p>
          <AmountText
            cents={totals.net}
            tone="inherit"
            className="text-3xl font-semibold tracking-tight md:text-4xl"
          />
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2.5">
          <HeroStat label="Entradas" data-testid="total-entradas">
            <AmountText cents={totals.income} tone="inherit" />
          </HeroStat>
          <HeroStat label="Saídas" data-testid="total-saidas">
            <AmountText cents={totals.expense} tone="inherit" />
          </HeroStat>
        </div>
      </HeroPanel>
      <p className="text-muted-foreground mb-5 px-1 text-sm">
        {totals.count} {totals.count === 1 ? "lançamento" : "lançamentos"} no filtro. Transferências
        aparecem na lista, mas não entram nas entradas e saídas.
      </p>

      {/* Atalhos de período: mudam só as datas e mantêm os outros filtros */}
      <nav
        aria-label="Período"
        className="-mx-4 mb-2 flex gap-2 overflow-x-auto px-4 py-1 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0"
      >
        {presets.map((p) => (
          <ChipLink
            key={p.label}
            href={`/lancamentos?${filtersToQuery(parsed, { de: p.from, ate: p.to, cursor: null })}`}
            active={parsed.filters.from === p.from && parsed.filters.to === p.to}
          >
            {p.label}
          </ChipLink>
        ))}
      </nav>
      <nav
        aria-label="Mais ações de lançamento"
        className="-mx-4 mb-3 flex gap-2 overflow-x-auto px-4 py-1 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0"
      >
        <ChipLink href="/lancamentos/transferencia">
          <ArrowLeftRight aria-hidden />
          Transferência
        </ChipLink>
        <ChipLink href="/lancamentos/recorrencias">
          <Repeat aria-hidden />
          Recorrências
        </ChipLink>
        {page.canExport ? (
          <ChipLink href={`/lancamentos/exportar?${filtersToQuery(parsed)}`}>
            <Download aria-hidden />
            Exportar CSV
          </ChipLink>
        ) : null}
      </nav>

      <TransactionFilters parsed={parsed} options={page.options} />

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
