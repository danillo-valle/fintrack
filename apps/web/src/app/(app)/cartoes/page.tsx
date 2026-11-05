import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowLeftRight,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleDashed,
  CreditCard,
} from "lucide-react";
import { EmptyState } from "@/components/feedback/empty-state";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Meter, usedPercentLabel } from "@/components/visual/meter";
import { Note } from "@/components/visual/note";
import { SegmentedNav } from "@/components/visual/segmented-nav";
import { StatCard, SummaryGrid } from "@/components/visual/summary";
import { ToneChip } from "@/components/visual/tone-chip";
import { getCardsPage } from "@/features/bank/server/queries";
import { ReceivedList } from "@/features/bank/ui/received-list";
import { ChargeRow, StatementCheck } from "@/features/bank/ui/statement-check";
import { SyncLine } from "@/features/bank/ui/sync-line";
import { payerOptionFor } from "@/features/transactions/payers";
import { NewTransactionButton } from "@/features/transactions/ui/new-transaction-button";
import { requireUser } from "@/lib/auth/session";
import { CHARGE_LABEL } from "@/lib/labels";
import { formatBRL } from "@/lib/money";
import { cn } from "@/lib/utils";
import { civilDayMonth } from "@/lib/dates";

export const metadata: Metadata = { title: "Cartões" };

const monthName = new Intl.DateTimeFormat("pt-BR", { month: "long", timeZone: "UTC" });
const monthOfDue = (date: string) => monthName.format(new Date(`${date}T12:00:00Z`));
const NATURE_TABS = [
  { param: null, label: "Tudo" },
  { param: "fixas", label: "Fixas" },
  { param: "parcelas", label: "Parcelas" },
  { param: "variaveis", label: "Variáveis" },
] as const;
const STATE_TEXT = {
  upcoming: "ainda não abriu",
  open: "aberta",
  closed: "fechada",
  paid: "paga",
} as const;
const ARROW =
  "bg-card hover:bg-muted focus-visible:ring-ring grid size-11 shrink-0 place-items-center rounded-xl border outline-none focus-visible:ring-3";

// Cartões (M13.3a, ADR-025, prancha N-Cartoes): um cartão e uma fatura por vez, sem débito
// misturado. A fatura soma tudo o que o banco vai cobrar nela (inclusive o que ainda espera
// revisão); cada compra conta no mês em que a fatura vence. A fatura fechada pelo banco ou pelo PDF
// mostra os encargos e a conferência ao centavo.
export default async function CardsPage({ searchParams }: PageProps<"/cartoes">) {
  const session = await requireUser(); // toda página do app começa conferindo a sessão
  const params = await searchParams;
  const page = await getCardsPage(session, params);
  const header = (
    <PageHeader
      help="cartoes"
      title="Cartões"
      description="Uma fatura por vez, sem débito misturado"
      actions={<NewTransactionButton />}
    />
  );
  if (!page.chosen) {
    return (
      <>
        {header}
        <EmptyState
          icon={CreditCard}
          title="Nenhum cartão de crédito"
          description="Ligue o banco ou cadastre o cartão em Ajustes › Contas e cartões."
          action={
            <Button asChild>
              <Link href="/ajustes/contas">Ir para Contas e cartões</Link>
            </Button>
          }
        />
      </>
    );
  }
  const { chosen, statement, previous, next, nature } = page;
  const query = (extra: Record<string, string | null>) => {
    const q = new URLSearchParams();
    q.set("conta", chosen.id);
    for (const [key, value] of Object.entries(extra)) if (value) q.set(key, value);
    return `/cartoes?${q.toString()}`;
  };
  const natureParam = NATURE_TABS.find((t) => t.param && params.tipo === t.param)?.param ?? null;
  const limit = chosen.creditLimit;
  const available = chosen.availableCredit;
  const used = limit !== null && available !== null ? limit - available : null;
  const pending = page.purchases.filter((p) => p.status === "PENDING").length;
  const rows = page.purchases.map((p) => ({
    ...p,
    note: [
      p.cardLastFour ? `final ${p.cardLastFour}` : null,
      payerOptionFor(p.payer, page.payers)?.name ?? null,
      p.otherWallet ? `no ambiente ${p.otherWallet}` : null,
    ]
      .filter(Boolean)
      .join(" · "),
    canEdit: page.canEdit,
  }));

  return (
    <>
      {header}
      <div className="flex flex-col gap-5">
        {page.accounts.length > 1 ? (
          <nav aria-label="Cartão" className="grid gap-3 md:grid-cols-2">
            {page.accounts.map((a) => {
              const active = a.id === chosen.id;
              return (
                <Link
                  key={a.id}
                  href={`/cartoes?conta=${a.id}`}
                  aria-current={active ? "true" : undefined}
                  className={cn(
                    "focus-visible:ring-ring flex min-w-0 items-center gap-3 rounded-[1.125rem] border px-4 py-3 outline-none focus-visible:ring-3",
                    active ? "border-primary bg-primary/8 border-2" : "bg-card hover:bg-muted",
                  )}
                >
                  <CreditCard aria-hidden className="size-6 shrink-0" />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <strong className="truncate">{a.name}</strong>
                    <span className="text-muted-foreground tabular truncate font-mono text-xs">
                      {[
                        a.lastFour ? `···· ${a.lastFour}` : null,
                        a.bill ? `vence ${civilDayMonth(a.bill.dueDate)}` : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </span>
                  <span className="tabular font-mono font-extrabold">
                    {formatBRL(a.bill?.amount ?? 0n)}
                  </span>
                </Link>
              );
            })}
          </nav>
        ) : null}

        {statement ? (
          <section
            aria-labelledby="fatura-titulo"
            className="bg-card flex flex-col gap-4 rounded-[1.25rem] border p-4 md:p-5"
          >
            <div className="flex items-center gap-2.5">
              {previous ? (
                <Link
                  href={query({ fatura: previous.id, tipo: natureParam })}
                  aria-label={`Fatura anterior: vence em ${civilDayMonth(previous.dueDate)}`}
                  className={ARROW}
                >
                  <ChevronLeft aria-hidden className="size-[1.125rem]" />
                </Link>
              ) : (
                <span aria-hidden className="size-11 shrink-0" />
              )}
              <div className="min-w-0 flex-1 text-center">
                <h2 id="fatura-titulo" className="text-lg font-extrabold md:text-xl">
                  Fatura que vence em {civilDayMonth(statement.dueDate)}
                </h2>
                <p className="text-muted-foreground text-[0.8125rem]">
                  {STATE_TEXT[statement.state]}
                  {statement.state === "upcoming"
                    ? ` (abre em ${civilDayMonth(statement.window.start)})`
                    : ""}{" "}
                  · fecha em {civilDayMonth(statement.closingDate)} · compras de{" "}
                  {civilDayMonth(statement.window.start)} a {civilDayMonth(statement.window.end)}
                </p>
              </div>
              {next ? (
                <Link
                  href={query({ fatura: next.id, tipo: natureParam })}
                  aria-label={`Próxima fatura: vence em ${civilDayMonth(next.dueDate)}`}
                  className={ARROW}
                >
                  <ChevronRight aria-hidden className="size-[1.125rem]" />
                </Link>
              ) : (
                <span aria-hidden className="size-11 shrink-0" />
              )}
            </div>
            <SummaryGrid
              label="Resumo da fatura"
              className="border-t pt-4 md:grid-cols-[minmax(0,1.3fr)_repeat(3,minmax(0,1fr))]"
            >
              <StatCard
                label={statement.closed ? "Total da fatura" : "Fatura até agora"}
                data-testid="fatura-total"
                note={`conta em ${monthOfDue(statement.dueDate)}, o mês do vencimento`}
              >
                <span className="tabular font-mono">
                  {formatBRL(statement.closed?.total ?? statement.purchases)}
                </span>
              </StatCard>
              <StatCard label="Fixas" note="contas e assinaturas que se repetem">
                <span className="tabular font-mono">{formatBRL(statement.byNature.fixed)}</span>
              </StatCard>
              <StatCard label="Parcelas" note="compras parceladas">
                <span className="tabular font-mono">
                  {formatBRL(statement.byNature.installment)}
                </span>
              </StatCard>
              <StatCard label="Variáveis" note="o resto">
                <span className="tabular font-mono">{formatBRL(statement.byNature.variable)}</span>
              </StatCard>
            </SummaryGrid>
            {limit !== null && available !== null && used !== null ? (
              <div className="flex flex-col gap-1.5">
                <div className="flex flex-wrap justify-between gap-2 text-sm">
                  <span>
                    Limite disponível{" "}
                    <span className="tabular font-mono font-bold">{formatBRL(available)}</span>
                  </span>
                  <span className="text-muted-foreground tabular font-mono">
                    de {formatBRL(limit)}
                  </span>
                </div>
                <Meter
                  used={used}
                  total={limit}
                  label={`Limite usado: ${usedPercentLabel(used, limit)}. Disponível ${formatBRL(available)} de ${formatBRL(limit)}.`}
                />
              </div>
            ) : null}
            {chosen.connectionId ? (
              <SyncLine
                bankUpdatedAt={page.bankUpdatedAt}
                lastSyncedAt={page.lastSyncedAt}
                canSync={page.canSync}
              />
            ) : null}
          </section>
        ) : null}

        {statement ? (
          <section
            aria-labelledby="compras-titulo"
            className="bg-card flex flex-col gap-3 rounded-[1.25rem] border p-4 md:p-5"
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 id="compras-titulo" className="text-[1.0625rem] font-extrabold md:text-xl">
                Compras desta fatura
              </h2>
              <SegmentedNav
                label="Tipo da despesa"
                items={NATURE_TABS.map((t) => ({
                  href: query({ fatura: statement.id, tipo: t.param }),
                  label: t.label,
                  active: t.param === natureParam,
                }))}
              />
            </div>
            {pending > 0 ? (
              <span>
                <ToneChip tone={4} icon={CircleDashed}>
                  {pending === 1 ? "1 a revisar" : `${pending} a revisar`}
                </ToneChip>
              </span>
            ) : null}
            {rows.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                {nature
                  ? "Nenhuma compra deste tipo nesta fatura."
                  : "Nenhuma compra nesta fatura ainda."}
              </p>
            ) : (
              <ReceivedList items={rows} choices={page.categories} label="Compras desta fatura" />
            )}
          </section>
        ) : (
          <p className="text-muted-foreground text-sm">Este cartão ainda não tem compras.</p>
        )}

        {statement?.closed ? (
          <section
            aria-labelledby="fatura-fechada"
            className="bg-card flex flex-col gap-3 rounded-[1.25rem] border p-4 md:p-5"
          >
            <div className="flex items-center justify-between gap-2">
              <h2 id="fatura-fechada" className="text-[1.0625rem] font-extrabold md:text-xl">
                {statement.closed.source === "PDF" ? "Da fatura em PDF" : "Fechada pelo banco"}
              </h2>
              {statement.state === "paid" ? (
                <ToneChip tone={5} icon={CheckCircle2}>
                  Paga
                </ToneChip>
              ) : null}
            </div>
            <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-2 text-[0.9375rem]">
              <dt>Compras</dt>
              <dd className="tabular m-0 text-right font-mono">
                {formatBRL(statement.closed.importedPurchases)}
              </dd>
              {(["IOF", "LATE_INTEREST", "LATE_FEE", "REMUNERATIVE_INTEREST", "OTHER"] as const)
                .filter(
                  (kind) =>
                    kind === "IOF" || statement.closed?.charges.some((c) => c.kind === kind),
                )
                .map((kind) => (
                  <ChargeRow
                    key={kind}
                    label={CHARGE_LABEL[kind]}
                    cents={(statement.closed?.charges ?? [])
                      .filter((c) => c.kind === kind)
                      .reduce((sum, c) => sum + c.amount, 0n)}
                  />
                ))}
              <dt className="border-t pt-2 font-extrabold">Total da fatura</dt>
              <dd className="tabular m-0 border-t pt-2 text-right font-mono font-extrabold">
                {formatBRL(statement.closed.total)}
              </dd>
              {statement.closed.minimumPayment !== null ? (
                <>
                  <dt className="text-muted-foreground">Pagamento mínimo</dt>
                  <dd className="text-muted-foreground tabular m-0 text-right font-mono">
                    {formatBRL(statement.closed.minimumPayment)}
                  </dd>
                </>
              ) : null}
              {statement.payments.map((p) => (
                <ChargeRow
                  key={`${p.paidOn}-${p.amount}`}
                  label={`Pago em ${civilDayMonth(p.paidOn)}`}
                  cents={p.amount}
                  muted
                />
              ))}
            </dl>
            <StatementCheck
              check={statement.closed.check}
              fromPdf={statement.closed.source === "PDF"}
              purchaseCount={statement.closed.importedCount}
              purchases={statement.closed.importedPurchases}
              charges={statement.closed.total - statement.closed.importedPurchases}
            />
          </section>
        ) : null}

        {previous && page.previousPaid.length > 0 ? (
          <Note icon={ArrowLeftRight}>
            A fatura que venceu em {civilDayMonth(previous.dueDate)} foi paga{" "}
            {page.previousPaid
              .map(
                (p) =>
                  `em ${civilDayMonth(p.paidOn)}${p.fromAccount ? ` pela ${p.fromAccount}` : ""} (${formatBRL(p.amount)})`,
              )
              .join(" e ")}
            .
          </Note>
        ) : null}
      </div>
    </>
  );
}
