import type { Metadata } from "next";
import Link from "next/link";
import { CheckCircle2, ChevronLeft, CircleDashed, Info, TriangleAlert } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Meter, usedPercentLabel } from "@/components/visual/meter";
import { HighlightCard, StatCard, SummaryGrid } from "@/components/visual/summary";
import { ToneChip } from "@/components/visual/tone-chip";
import { getCardPage } from "@/features/bank/server/queries";
import { ReceivedList } from "@/features/bank/ui/received-list";
import { SyncLine } from "@/features/bank/ui/sync-line";
import { notFoundOnDenied } from "@/lib/access";
import { requireUser } from "@/lib/auth/session";
import { formatBRL } from "@/lib/money";
import { TEXT_LINK } from "@/lib/styles";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Cartão" };

const SEGMENT =
  "focus-visible:ring-ring grid h-9 place-items-center rounded-[0.5625rem] text-muted-foreground text-sm font-semibold first:text-foreground outline-none focus-visible:ring-3 first:bg-card first:font-bold first:shadow-sm";
const dm = (date: string) => `${date.slice(8, 10)}/${date.slice(5, 7)}`;
const MONTHS = [
  "janeiro",
  "fevereiro",
  "março",
  "abril",
  "maio",
  "junho",
  "julho",
  "agosto",
  "setembro",
  "outubro",
  "novembro",
  "dezembro",
];
const monthName = (key: string) => MONTHS[Number.parseInt(key.slice(5, 7), 10) - 1] ?? key;
const CHARGE_LABEL: Record<string, string> = {
  IOF: "IOF",
  LATE_INTEREST: "Juros de mora",
  LATE_FEE: "Multa",
  REMUNERATIVE_INTEREST: "Juros do rotativo",
  OTHER: "Outros encargos",
};

// A página do cartão (M09.1, pranchas E-Cartao e E-CelCartao): a fatura aberta calculada das
// compras que o banco já mandou (cada uma com a categoria em um clique) e a última fatura fechada
// pelo banco, com encargos e a conferência ao centavo. Quem vê: quem vê o ambiente da conta.
export default async function CardPage({ params }: PageProps<"/carteiras/conta/[accountId]">) {
  const session = await requireUser(); // toda página do app começa conferindo a sessão
  const { accountId } = await params;
  const page = await getCardPage(session, accountId).catch(notFoundOnDenied);
  const { account, balance, window, open, openTotal, statements } = page;
  const [latest, ...older] = statements;
  const limit = balance?.creditLimit ?? null;
  const available = balance?.availableCredit ?? null;
  const used = limit !== null && available !== null ? limit - available : null;
  const uncategorized = open.filter((t) => !t.category).length;
  const title = page.lastFour ? `${account.name} final ${page.lastFour}` : account.name;
  const rows = open.map((t) => ({
    ...t,
    note: t.otherWallet ? `no ambiente ${t.otherWallet}` : null,
    canEdit: page.canEdit,
  }));

  return (
    <>
      <nav aria-label="Caminho" className="mb-1">
        <Link
          href="/carteiras"
          className={cn(TEXT_LINK, "inline-flex min-h-8 items-center gap-1 text-sm")}
        >
          <ChevronLeft aria-hidden className="size-4" />
          Carteiras · {page.wallet.name}
        </Link>
      </nav>
      <PageHeader
        title={title}
        description={`${account.institution ?? "Banco"} · ambiente ${page.wallet.name}`}
        actions={
          account.connectionId ? (
            <SyncLine
              bankUpdatedAt={page.bankUpdatedAt}
              lastSyncedAt={page.lastSyncedAt}
              canSync={page.canSync}
            />
          ) : null
        }
      />

      <div className="flex flex-col gap-5">
        <SummaryGrid
          label="Limite e datas"
          className="md:grid-cols-[minmax(0,1.3fr)_repeat(3,minmax(0,1fr))]"
        >
          {/* Celular (prancha E-CelCartao): um cartão só, com datas e limite dentro. Computador
              (E-Cartao): o destaque e três cartões ao lado */}
          <HighlightCard
            label="Fatura aberta até agora"
            data-testid="fatura-aberta"
            note={
              <>
                <span className="hidden md:inline">
                  soma{" "}
                  {open.length === 1
                    ? "da compra recebida"
                    : `das ${open.length} compras recebidas`}
                </span>
                <span className="flex w-full flex-col gap-1.5 md:hidden">
                  {window ? (
                    <span>
                      fecha {dm(window.closingDate)} · vence {dm(window.dueDate)}
                    </span>
                  ) : null}
                  {limit !== null && available !== null && used !== null ? (
                    <>
                      <Meter
                        used={used}
                        total={limit}
                        label={`Limite usado: ${usedPercentLabel(used, limit)}. Disponível ${formatBRL(available)} de ${formatBRL(limit)}.`}
                      />
                      <span className="tabular font-mono">
                        disponível {formatBRL(available)} de {formatBRL(limit)}
                      </span>
                    </>
                  ) : null}
                </span>
              </>
            }
          >
            <span className="tabular font-mono">{formatBRL(openTotal)}</span>
          </HighlightCard>
          <StatCard
            label="Fecha"
            className="hidden md:flex"
            note={window ? `compras até ${dm(window.to)} entram nesta` : undefined}
          >
            <span className="tabular font-mono">{window ? dm(window.closingDate) : "—"}</span>
          </StatCard>
          <StatCard label="Vence" className="hidden md:flex" note="informado pelo banco">
            <span className="tabular font-mono">{window ? dm(window.dueDate) : "—"}</span>
          </StatCard>
          <StatCard label="Disponível" className="hidden md:flex">
            {limit !== null && available !== null && used !== null ? (
              <span className="flex w-full flex-col gap-1.5">
                <span className="tabular font-mono">{formatBRL(available)}</span>
                <Meter
                  used={used}
                  total={limit}
                  label={`Limite usado: ${usedPercentLabel(used, limit)}. Disponível ${formatBRL(available)} de ${formatBRL(limit)}.`}
                />
                <span className="text-muted-foreground tabular font-mono text-xs font-normal">
                  de {formatBRL(limit)}
                </span>
              </span>
            ) : (
              "—"
            )}
          </StatCard>
        </SummaryGrid>

        {latest ? (
          // Celular: "Aberta | Fechadas" leva a cada parte da página (as duas ficam abertas)
          <nav
            aria-label="Faturas"
            className="bg-muted grid grid-cols-2 gap-0.5 rounded-xl border p-1 md:hidden"
          >
            <a href="#fatura-aberta-titulo" className={SEGMENT}>
              Aberta
            </a>
            <a href="#fatura-fechada" className={SEGMENT}>
              Fechadas
            </a>
          </nav>
        ) : null}

        <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1.75fr)_minmax(0,1fr)]">
          <section
            aria-labelledby="fatura-aberta-titulo"
            className="bg-card flex flex-col gap-3 rounded-[1.25rem] border p-4 md:p-5"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2
                id="fatura-aberta-titulo"
                className="text-[1.0625rem] font-extrabold tracking-[-0.01em] md:text-xl"
              >
                {window
                  ? `Fatura de ${monthName(window.referenceMonth)}, aberta`
                  : "Recebidos do banco"}
              </h2>
              <span className="flex flex-wrap gap-1.5">
                {open.some((t) => t.status === "PENDING") ? (
                  <ToneChip tone={4} icon={CircleDashed}>
                    {open.filter((t) => t.status === "PENDING").length} a revisar
                  </ToneChip>
                ) : null}
                {uncategorized > 0 ? (
                  <ToneChip tone={1} icon={Info}>
                    {uncategorized} sem categoria
                  </ToneChip>
                ) : null}
              </span>
            </div>
            <p className="text-muted-foreground text-sm">
              Compras que o banco já mandou e que ainda não têm fatura fechada. Ficam em Recebidos
              até você revisar; não somam no orçamento. Clique na categoria para escolher ou trocar.
            </p>
            {rows.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                Nenhuma compra recebida nesta fatura ainda.
              </p>
            ) : (
              <ReceivedList
                items={rows}
                choices={page.categories}
                label="Compras da fatura aberta"
              />
            )}
            <div className="flex justify-between border-t-2 pt-2.5 font-bold">
              <span>Total até agora</span>
              <span className="tabular font-mono">− {formatBRL(openTotal)}</span>
            </div>
          </section>

          {latest ? (
            <section
              aria-labelledby="fatura-fechada"
              className="bg-card flex flex-col gap-3 rounded-[1.25rem] border p-4 md:p-5"
            >
              <div className="flex items-center justify-between gap-2">
                <h2
                  id="fatura-fechada"
                  className="text-[1.0625rem] font-extrabold tracking-[-0.01em] md:text-xl"
                >
                  Fatura de {monthName(latest.referenceMonth)}
                </h2>
                {latest.status === "PAID" ? (
                  <ToneChip tone={5} icon={CheckCircle2}>
                    Paga
                  </ToneChip>
                ) : (
                  <ToneChip tone={4} icon={CircleDashed}>
                    Fechada
                  </ToneChip>
                )}
              </div>
              <span className="text-muted-foreground text-[0.8125rem]">
                Fechada pelo banco em {dm(latest.closingDate)} ·{" "}
                {latest.status === "PAID" ? "venceu" : "vence"} em {dm(latest.dueDate)}
              </span>
              <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-2 text-[0.9375rem]">
                <dt>Compras</dt>
                <dd className="tabular m-0 text-right font-mono">{formatBRL(latest.purchases)}</dd>
                {(["IOF", "LATE_INTEREST", "LATE_FEE", "REMUNERATIVE_INTEREST", "OTHER"] as const)
                  .filter((kind) => kind === "IOF" || latest.charges.some((c) => c.kind === kind))
                  .map((kind) => (
                    <ChargeRow
                      key={kind}
                      label={CHARGE_LABEL[kind] ?? kind}
                      cents={latest.charges
                        .filter((c) => c.kind === kind)
                        .reduce((sum, c) => sum + c.amount, 0n)}
                    />
                  ))}
                <dt className="border-t pt-2 font-extrabold">Total da fatura</dt>
                <dd
                  className="tabular m-0 border-t pt-2 text-right font-mono font-extrabold"
                  data-testid="fatura-total"
                >
                  {formatBRL(latest.total)}
                </dd>
                {latest.minimumPayment !== null ? (
                  <>
                    <dt className="text-muted-foreground">Pagamento mínimo</dt>
                    <dd className="text-muted-foreground tabular m-0 text-right font-mono">
                      {formatBRL(latest.minimumPayment)}
                    </dd>
                  </>
                ) : null}
                {latest.payments.map((p) => (
                  <ChargeRow
                    key={`${p.paidOn}-${p.amount}`}
                    label={`Pago em ${dm(p.paidOn)}`}
                    cents={p.amount}
                    muted
                  />
                ))}
              </dl>
              <Check
                check={latest.check}
                purchaseCount={latest.purchaseCount}
                purchases={latest.purchases}
                charges={latest.total - latest.purchases}
              />
              {older.length > 0 ? (
                <ul aria-label="Faturas anteriores" className="flex flex-col gap-1.5 pt-1">
                  {older.map((s) => (
                    <li
                      key={s.id}
                      className="bg-muted/50 flex justify-between rounded-xl border px-3 py-2.5 text-sm"
                    >
                      <span>
                        {monthName(s.referenceMonth).replace(/^./, (c) => c.toUpperCase())} ·{" "}
                        {s.status === "PAID" ? "paga" : "fechada"}
                      </span>
                      <span className="tabular font-mono">{formatBRL(s.total)}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </section>
          ) : (
            <section
              aria-labelledby="fatura-fechada"
              className="bg-card flex flex-col gap-2 rounded-[1.25rem] border p-4 md:p-5"
            >
              <h2 id="fatura-fechada" className="text-[1.0625rem] font-extrabold md:text-xl">
                Faturas fechadas
              </h2>
              <p className="text-muted-foreground text-sm">
                A primeira fatura fechada pelo banco aparece aqui, com IOF, juros e a conferência ao
                centavo.
              </p>
            </section>
          )}
        </div>
      </div>
    </>
  );
}

function ChargeRow({
  label,
  cents,
  muted = false,
}: {
  label: string;
  cents: bigint;
  muted?: boolean;
}) {
  return (
    <>
      <dt className={muted ? "text-muted-foreground" : undefined}>{label}</dt>
      <dd className={cn("tabular m-0 text-right font-mono", muted && "text-muted-foreground")}>
        {formatBRL(cents)}
      </dd>
    </>
  );
}

function Check({
  check,
  purchaseCount,
  purchases,
  charges,
}: {
  check: { kind: "matches" } | { kind: "partial" } | { kind: "difference"; difference: bigint };
  purchaseCount: number;
  purchases: bigint;
  charges: bigint;
}) {
  if (check.kind === "matches") {
    return (
      <div
        className="bg-income/12 grid grid-cols-[1.375rem_minmax(0,1fr)] gap-2.5 rounded-xl p-3"
        data-testid="fatura-confere"
      >
        <CheckCircle2 aria-hidden className="text-income size-5" />
        <span className="text-sm">
          <strong>Confere ao centavo.</strong> As {purchaseCount} compras ligadas a esta fatura
          somam {formatBRL(purchases)}; com{" "}
          {charges > 0n ? `os encargos (${formatBRL(charges)})` : "os encargos"}, dão o total do
          banco.
        </span>
      </div>
    );
  }
  if (check.kind === "partial") {
    return (
      <div className="bg-muted/60 grid grid-cols-[1.375rem_minmax(0,1fr)] gap-2.5 rounded-xl border p-3">
        <Info aria-hidden className="text-chart-1-ink size-5" />
        <span className="text-sm">
          Esta fatura começou antes da data de corte: só parte das compras dela foi importada, de
          propósito.
        </span>
      </div>
    );
  }
  return (
    <div
      className="bg-expense/10 grid grid-cols-[1.375rem_minmax(0,1fr)] gap-2.5 rounded-xl p-3"
      data-testid="fatura-diferenca"
    >
      <TriangleAlert aria-hidden className="text-expense size-5" />
      <span className="text-sm">
        <strong>
          Diferença de {formatBRL(check.difference < 0n ? -check.difference : check.difference)}
        </strong>{" "}
        entre as compras recebidas e o total do banco. A conferência compra a compra vem com a
        revisão (M09.2).
      </span>
    </div>
  );
}
