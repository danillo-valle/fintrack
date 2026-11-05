import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { CreditCard, Download, Landmark, PiggyBank, ReceiptText, Wallet } from "lucide-react";
import { EmptyState } from "@/components/feedback/empty-state";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { ListHeader } from "@/components/visual/list-header";
import { Note } from "@/components/visual/note";
import { SegmentedNav } from "@/components/visual/segmented-nav";
import { categoryChoices } from "@/features/bank/server/queries";
import { ReceivedList } from "@/features/bank/ui/received-list";
import { environmentsSentence } from "@/features/transactions/environments";
import { dayInWords, periodTitle, sliceTitle } from "@/features/transactions/presentation";
import { filtersToQuery, periodBounds } from "@/features/transactions/schemas";
import { getTransactionsPage } from "@/features/transactions/server/queries";
import { AccountSummary } from "@/features/transactions/ui/account-summary";
import { AccountForecast } from "@/features/transactions/ui/repeat/account-forecast";
import { ActiveFilters, BackLink } from "@/features/transactions/ui/active-filters";
import { EnvironmentSwitcher } from "@/features/transactions/ui/environment-switcher";
import { activeFilterCount, TransactionFiltersForm } from "@/features/transactions/ui/filters";
import { PayerCombo, PeriodCombo } from "@/features/transactions/ui/list-combos";
import { NewTransactionButton } from "@/features/transactions/ui/new-transaction-button";
import { SliceParts, SliceSummary } from "@/features/transactions/ui/slice-parts";
import { TransactionList } from "@/features/transactions/ui/transaction-list";
import { requireUser } from "@/lib/auth/session";
import { TEXT_LINK } from "@/lib/styles";

export const metadata: Metadata = { title: "Lançamentos" };

const ACCOUNT_ICON = { CHECKING: Landmark, SAVINGS: PiggyBank, MEAL_VOUCHER: Wallet, CASH: Wallet };

// Lançamentos (M07; separados no M13.3a, ADR-025, pranchas N-Lancamentos e N-DoPainel). Só o que
// passou pelas contas que não são cartão, uma conta por vez, com o saldo; as compras no cartão
// ficam em Cartões, por fatura. Um número do painel abre o recorte em duas partes (contas e
// cartões), cada uma com o seu total. A fila do banco (?situacao=recebidos) continua aqui.
export default async function TransactionsPage({ searchParams }: PageProps<"/lancamentos">) {
  const session = await requireUser(); // toda página do app começa conferindo a sessão
  const page = await getTransactionsPage(session, await searchParams);
  if (page.cardRedirect) redirect(page.cardRedirect);
  const { parsed, view, today } = page;
  const href = (extra: Parameters<typeof filtersToQuery>[1]) =>
    `/lancamentos?${filtersToQuery(parsed, { cursor: null, cursorCartoes: null, ...extra })}`;
  const title = periodTitle(parsed.filters.period, today);
  const header = (
    <PageHeader
      help="lancamentos"
      title="Lançamentos"
      description="O dinheiro que entrou e saiu das suas contas"
      actions={
        <>
          <EnvironmentSwitcher
            environments={page.environments}
            current={parsed.walletId}
            hrefFor={(walletId) =>
              `/lancamentos?${filtersToQuery({ ...parsed, walletId }, { cursor: null, cursorCartoes: null })}`
            }
          />
          <NewTransactionButton />
        </>
      }
    />
  );
  const combos = (
    <div className="flex flex-wrap items-center gap-2.5">
      <PeriodCombo parsed={parsed} action="/lancamentos" today={today} />
      {page.payers.length > 0 ? (
        <PayerCombo parsed={parsed} action="/lancamentos" payers={page.payers} />
      ) : null}
    </div>
  );
  const csv = page.canExport ? (
    <Button asChild variant="outline" className="h-11 rounded-xl px-3.5 font-bold">
      <Link href={`/lancamentos/exportar?${filtersToQuery(parsed)}`}>
        <Download aria-hidden />
        <span>
          <span className="sr-only">Exportar </span>CSV
        </span>
      </Link>
    </Button>
  ) : null;
  const filtersPanel = <TransactionFiltersForm parsed={parsed} options={page.options} />;
  const pending =
    page.received.count > 0 ? (
      <p className="text-muted-foreground px-1 text-[0.8125rem]">
        <Link href="/lancamentos/recebidos" className={TEXT_LINK} data-testid="link-recebidos">
          {page.received.count === 1
            ? "1 recebido do banco"
            : `${page.received.count} recebidos do banco`}
        </Link>{" "}
        {page.received.count === 1 ? "espera" : "esperam"} revisão e não entram nestes totais.
      </p>
    ) : null;

  // ── A fila do banco ─────────────────────────────────────────────────────────
  if (view === "received" && page.main) {
    const choices = await categoryChoices(session);
    return (
      <>
        {header}
        <ActiveFilters
          parsed={parsed}
          options={page.options}
          payers={page.payers}
          className="-mt-1 mb-4"
        />
        <p className="text-muted-foreground mb-5 px-1 text-[0.8125rem]">
          Recebidos do banco: ficam fora do painel e dos outros totais até a revisão.{" "}
          <Link href="/lancamentos/recebidos" className={TEXT_LINK}>
            Revisar e confirmar
          </Link>
        </p>
        <div className="bg-card rounded-[1.25rem] border px-4 py-1 md:px-5">
          <ReceivedList
            label="Recebidos do banco"
            choices={choices}
            items={page.main.items.map((item) => ({
              id: item.id,
              occurredOn: item.occurredOn,
              description: item.description,
              label: item.label,
              amount: item.amount,
              status: item.status,
              category: item.category,
              categorizedBy: item.categorizedBy,
              categorizationConfidence: item.categorizationConfidence,
              natureView: item.natureView,
              installment: item.installment,
              original: item.original,
              note: `${item.card ? `${item.card.nickname} final ${item.card.lastFour}` : item.account.name} · ${item.wallet.name}`,
              canEdit: item.canEdit,
            }))}
          />
        </div>
        <Pages page={page.main.nextCursor ? href({ cursor: page.main.nextCursor }) : null} />
      </>
    );
  }

  // ── O recorte de um número do painel: contas e cartões, separados ───────────
  if (view === "slice" && page.main && page.cards) {
    const category =
      parsed.filters.categoryId === "none"
        ? "Sem categoria"
        : page.options.categories.find((c) => c.id === parsed.filters.categoryId)?.name;
    return (
      <>
        <BackLink parsed={parsed} categories={page.options.categories} />
        {header}
        <div className="flex flex-col gap-5">
          <ActiveFilters parsed={parsed} options={page.options} payers={page.payers} />
          {combos}
          <SliceSummary
            title={sliceTitle({
              category: category ?? null,
              type: parsed.filters.type,
              period: parsed.filters.period,
              upTo: parsed.filters.upTo,
              today,
            })}
            accounts={page.main}
            cards={page.cards}
          />
          <p className="text-muted-foreground px-1 text-[0.8125rem]">
            As duas partes ficam separadas, como em Lançamentos e em Cartões; a soma é o número do
            painel. No cartão, cada compra conta no mês em que a fatura dela vence.{" "}
            {environmentsSentence(page.environments, parsed.walletId, page.otherMembers)}
          </p>
          {pending}
          <SliceParts
            accounts={page.main}
            cards={page.cards}
            payers={page.payers}
            today={today}
            moreAccounts={
              page.main.nextCursor
                ? `/lancamentos?${filtersToQuery(parsed, { cursor: page.main.nextCursor })}`
                : null
            }
            moreCards={
              page.cards.nextCursor
                ? `/lancamentos?${filtersToQuery(parsed, { cursorCartoes: page.cards.nextCursor })}`
                : null
            }
          />
        </div>
      </>
    );
  }

  // ── Uma conta ───────────────────────────────────────────────────────────────
  const { account, main } = page;
  const tabs =
    page.accounts.length > 0 ? (
      <SegmentedNav
        label="Conta"
        className="md:self-start"
        items={page.accounts.map((a) => ({
          href: href({ conta: a.id }),
          label: a.name,
          shortLabel:
            a.kind === "SAVINGS" ? "Poupança" : a.kind === "CHECKING" ? "Conta corrente" : a.name,
          icon: ACCOUNT_ICON[a.kind as keyof typeof ACCOUNT_ICON] ?? Wallet,
          active: a.id === account?.id,
        }))}
      />
    ) : null;
  return (
    <>
      <BackLink parsed={parsed} categories={page.options.categories} />
      {header}
      <div className="flex flex-col gap-5">
        {tabs}
        <Note icon={CreditCard}>
          As compras no cartão de crédito ficam em{" "}
          <Link href="/cartoes" className={TEXT_LINK}>
            Cartões
          </Link>
          , por fatura. Aqui só o que passou pela conta.
        </Note>
        {combos}
        <ActiveFilters parsed={parsed} options={page.options} payers={page.payers} />
        {account && main ? (
          <>
            <AccountSummary
              balance={account.balance}
              totals={main.totals}
              startLabel={`Saldo em ${dayInWords(periodBounds(parsed.filters.period).from)}`}
              asOf={account.asOf}
            />
            <p className="text-muted-foreground -mt-2 px-1 text-[0.8125rem]">
              Transferências (para a poupança, para alguém do lar) e o pagamento das faturas
              aparecem aqui, porque saíram desta conta, mas ficam fora das entradas e das saídas.{" "}
              {environmentsSentence(page.environments, parsed.walletId, page.otherMembers)}
            </p>
            {pending}
            {page.forecast ? <AccountForecast forecast={page.forecast} /> : null}
            <section aria-labelledby="lista-titulo" className="flex flex-col gap-3">
              <ListHeader
                id="lista-titulo"
                title={title}
                subtitle={`${main.totals.count} ${main.totals.count === 1 ? "lançamento" : "lançamentos"} · ${account.name}`}
                actions={csv}
                panel={filtersPanel}
                activeCount={activeFilterCount(parsed)}
              />
              {main.items.length === 0 ? (
                <EmptyState
                  icon={ReceiptText}
                  title={
                    parsed.cursor ? "Não há mais lançamentos" : "Nenhum lançamento neste período"
                  }
                  description="Mude o período ou os filtros, ou registre um lançamento novo."
                  action={
                    <Button asChild>
                      <Link href="/lancamentos/novo">Registrar lançamento</Link>
                    </Button>
                  }
                />
              ) : (
                <TransactionList
                  items={main.items}
                  payers={page.payers}
                  today={today}
                  dayHeading="h3"
                />
              )}
            </section>
            <Pages
              first={parsed.cursor ? href({}) : null}
              page={main.nextCursor ? href({ cursor: main.nextCursor }) : null}
            />
          </>
        ) : (
          <EmptyState
            icon={Landmark}
            title={page.hasWallets ? "Nenhuma conta ainda" : "Crie o seu lar primeiro"}
            description={
              page.hasWallets
                ? "Cadastre a conta corrente (ou ligue o banco) em Ajustes › Contas e cartões."
                : "Crie o seu lar em Carteiras para começar a lançar."
            }
            action={
              <Button asChild>
                <Link href={page.hasWallets ? "/ajustes/contas" : "/carteiras"}>
                  {page.hasWallets ? "Ir para Contas e cartões" : "Ir para Carteiras"}
                </Link>
              </Button>
            }
          />
        )}
      </div>
    </>
  );
}

function Pages({ first = null, page }: { first?: string | null; page: string | null }) {
  if (!first && !page) return null;
  return (
    <nav aria-label="Páginas" className="mt-6 flex flex-wrap gap-4 text-sm">
      {first ? (
        <Link href={first} className={TEXT_LINK}>
          Voltar aos mais recentes
        </Link>
      ) : null}
      {page ? (
        <Link href={page} className={TEXT_LINK}>
          Ver mais antigos
        </Link>
      ) : null}
    </nav>
  );
}
