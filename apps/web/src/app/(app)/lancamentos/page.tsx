import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeftRight, Download, Plus, ReceiptText, Repeat } from "lucide-react";
import { EmptyState } from "@/components/feedback/empty-state";
import { PageHeader } from "@/components/layout/page-header";
import { AmountText } from "@/components/money/amount-text";
import { Button } from "@/components/ui/button";
import { getTransactionsPage } from "@/features/transactions/server/queries";
import { filtersToQuery } from "@/features/transactions/schemas";
import { TransactionFilters } from "@/features/transactions/ui/filters";
import { TransactionList } from "@/features/transactions/ui/transaction-list";
import { requireUser } from "@/lib/auth/session";
import { formatDate } from "@/lib/dates";
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

  return (
    <>
      <PageHeader
        title="Lançamentos"
        description={period}
        actions={
          <Button asChild variant="outline" className="hidden md:inline-flex">
            <Link href="/lancamentos/novo">
              <Plus aria-hidden />
              Novo lançamento
            </Link>
          </Button>
        }
      />

      <nav aria-label="Mais ações de lançamento" className="mb-4 flex flex-wrap gap-2">
        <Button asChild variant="outline" size="sm">
          <Link href="/lancamentos/transferencia">
            <ArrowLeftRight aria-hidden />
            Transferência
          </Link>
        </Button>
        <Button asChild variant="outline" size="sm">
          <Link href="/lancamentos/recorrencias">
            <Repeat aria-hidden />
            Recorrências
          </Link>
        </Button>
        {page.canExport ? (
          <Button asChild variant="outline" size="sm">
            <Link href={`/lancamentos/exportar?${filtersToQuery(parsed)}`}>
              <Download aria-hidden />
              Exportar CSV
            </Link>
          </Button>
        ) : null}
      </nav>

      <TransactionFilters parsed={parsed} options={page.options} />

      <section aria-labelledby="totais" className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <h2 id="totais" className="sr-only">
          Totais do filtro
        </h2>
        <div className="rounded-xl border p-4" data-testid="total-entradas">
          <p className="text-muted-foreground text-sm">Entradas</p>
          <AmountText cents={totals.income} className="text-lg" />
        </div>
        <div className="rounded-xl border p-4" data-testid="total-saidas">
          <p className="text-muted-foreground text-sm">Saídas</p>
          <AmountText cents={totals.expense} className="text-lg" />
        </div>
        <div className="rounded-xl border p-4" data-testid="total-saldo">
          <p className="text-muted-foreground text-sm">Saldo do período</p>
          <AmountText cents={totals.net} className="text-lg" />
        </div>
        <p className="text-muted-foreground text-sm sm:col-span-3">
          {totals.count} {totals.count === 1 ? "lançamento" : "lançamentos"} no filtro.
          Transferências aparecem na lista, mas não entram nas entradas e saídas.
        </p>
      </section>

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
        <TransactionList items={page.items} />
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
