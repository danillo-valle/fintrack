import Link from "next/link";
import { ArrowDownRight, ArrowUpRight, Repeat } from "lucide-react";
import { MoneyLink } from "@/components/money/money-link";
import { percentOf } from "@/lib/chart";
import { formatBRL } from "@/lib/money";
import { NUMBER_LINK } from "@/lib/styles";
import { cn } from "@/lib/utils";
import type { CashDetailRow, CashMonthView } from "../server/queries";

// Fluxo de caixa (M08, canvas D "Fluxo de caixa, 6 meses"): o resultado previsto de cada mês,
// a partir de zero. Barras verdes = entradas; vermelhas = despesas fixas; listradas = faturas e
// outras saídas (compra no cartão sai no vencimento da fatura). A tabela embaixo tem os mesmos
// números escritos (alternativa ao gráfico); cada valor leva ao detalhe do mês, conta por conta,
// e de lá aos lançamentos.

export const CASH_LEGEND = [
  { label: "Entradas", mark: "bar" as const, tone: "income" as const },
  { label: "Despesas fixas", mark: "bar" as const, tone: "expense" as const },
  { label: "Faturas e outras saídas", mark: "hatch" as const, tone: "expense" as const },
];

const DETAIL = "Ver o detalhe do mês";

/** "+ R$ 1,00" ou "− R$ 1,00": o sinal escrito, nunca só a cor. */
export const signed = (cents: bigint) =>
  `${cents < 0n ? "−" : "+"} ${formatBRL(cents < 0n ? -cents : cents)}`;

/** "8,5 mil" ou "850" (o rótulo curto em cima da barra), em bigint até o fim. */
function compact(cents: bigint): string {
  if (cents < 100_000n) return ((cents + 50n) / 100n).toString(); // reais, arredondado
  const tenths = (cents + 5_000n) / 10_000n; // décimos de milhar, arredondado
  const whole = tenths / 10n;
  const rest = tenths % 10n;
  return `${whole}${rest === 0n ? "" : `,${rest}`} mil`;
}

function ariaOf(m: CashMonthView) {
  return `${m.title}: entradas ${formatBRL(m.income)}; despesas fixas ${formatBRL(m.fixed)}; faturas e outras saídas ${formatBRL(m.other)}; resultado ${signed(m.net)}.`;
}

function scaleOf(months: readonly CashMonthView[]) {
  let max = 0n;
  for (const m of months) for (const v of [m.income, m.fixed + m.other]) if (v > max) max = v;
  return max;
}

/** O gráfico de colunas do computador: entradas ao lado das saídas empilhadas. */
export function CashFlowChart({ months }: { months: readonly CashMonthView[] }) {
  const max = scaleOf(months);
  return (
    <div className="hidden flex-col gap-2 md:flex" data-testid="fluxo-grafico">
      <div className="grid h-[15.625rem] grid-cols-6 items-end gap-3 border-b px-1">
        {months.map((m) => (
          <Link
            key={m.month}
            href={m.href}
            aria-label={`${ariaOf(m)} ${DETAIL}`}
            className="focus-visible:ring-ring flex h-full items-end justify-center gap-1.5 rounded-t-lg outline-none focus-visible:ring-3"
          >
            <span className="flex h-full flex-col items-center justify-end gap-1">
              {m.income > 0n ? (
                <span className="tabular text-muted-foreground font-mono text-[0.6875rem]">
                  {compact(m.income)}
                </span>
              ) : null}
              <span
                className="bg-income block w-[1.875rem] rounded-t-md"
                style={{ height: percentOf(m.income, max) }}
              />
            </span>
            <span className="flex h-full flex-col items-center justify-end">
              <span
                className="hatch block w-[1.875rem] rounded-t-md"
                style={
                  {
                    height: percentOf(m.other, max),
                    "--tone": "var(--expense)",
                  } as React.CSSProperties
                }
              />
              <span
                className={cn("bg-expense block w-[1.875rem]", m.other === 0n && "rounded-t-md")}
                style={{ height: percentOf(m.fixed, max) }}
              />
            </span>
          </Link>
        ))}
      </div>
      <div aria-hidden className="grid grid-cols-6 gap-3">
        {months.map((m) => (
          <span key={m.month} className="text-center text-[0.8125rem] font-semibold">
            {m.title}
          </span>
        ))}
      </div>
    </div>
  );
}

/** A tabela (computador): os mesmos números do gráfico, cada um com o caminho até o detalhe. */
export function CashFlowTable({ months }: { months: readonly CashMonthView[] }) {
  return (
    <div className="hidden overflow-x-auto rounded-[0.875rem] border md:block">
      <table className="w-full min-w-[47.5rem] border-collapse text-sm" data-testid="fluxo-tabela">
        <caption className="text-muted-foreground px-3.5 py-2.5 text-left text-[0.8125rem]">
          Os mesmos números do gráfico. Clique num valor para ver o detalhe do mês, conta por conta,
          e de lá os lançamentos.
        </caption>
        <thead>
          <tr className="bg-muted/60 text-muted-foreground text-xs tracking-[0.03em] uppercase">
            <th scope="col" className="px-3.5 py-2 text-left">
              Mês
            </th>
            <th scope="col" className="px-3.5 py-2 text-right">
              Entradas
            </th>
            <th scope="col" className="px-3.5 py-2 text-right">
              Despesas fixas
            </th>
            <th scope="col" className="px-3.5 py-2 text-right">
              Faturas e outras saídas
            </th>
            <th scope="col" className="px-3.5 py-2 text-right">
              Resultado
            </th>
            <th scope="col" className="px-3.5 py-2 text-right">
              Acumulado
            </th>
          </tr>
        </thead>
        <tbody>
          {months.map((m) => (
            <tr key={m.month} className="border-t" data-month={m.month}>
              <th
                scope="row"
                className="px-3.5 py-[0.6875rem] text-left font-bold whitespace-nowrap"
              >
                {m.title}
                {m.current ? <CurrentTag /> : null}
              </th>
              <td className="px-3.5 py-[0.6875rem] text-right">
                <MoneyLink
                  cents={m.income}
                  href={m.href}
                  label={`${m.title}, entradas`}
                  sign="+"
                  goes={DETAIL}
                  className="text-income font-semibold"
                />
              </td>
              <td className="px-3.5 py-[0.6875rem] text-right">
                <MoneyLink
                  cents={m.fixed}
                  href={m.href}
                  label={`${m.title}, despesas fixas`}
                  sign="−"
                  goes={DETAIL}
                  className="text-expense"
                />
              </td>
              <td className="px-3.5 py-[0.6875rem] text-right">
                <MoneyLink
                  cents={m.other}
                  href={m.href}
                  label={`${m.title}, faturas e outras saídas`}
                  sign="−"
                  goes={DETAIL}
                  className="text-expense"
                />
              </td>
              <td
                className="tabular px-3.5 py-[0.6875rem] text-right font-mono font-bold whitespace-nowrap"
                data-cents={m.net.toString()}
              >
                {signed(m.net)}
              </td>
              <td className="tabular text-hero-soft-foreground px-3.5 py-[0.6875rem] text-right font-mono font-bold whitespace-nowrap">
                {signed(m.cumulative)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CurrentTag() {
  return (
    <span className="bg-chart-1/14 text-chart-1-ink ml-2 rounded-full px-2 py-0.5 text-xs font-semibold whitespace-nowrap">
      em andamento
    </span>
  );
}

/** No celular: um cartão por mês, com as barras, os três valores e o acumulado. */
export function CashFlowCards({ months }: { months: readonly CashMonthView[] }) {
  const max = scaleOf(months);
  return (
    <ul className="flex flex-col gap-2.5 md:hidden" data-testid="fluxo-cartoes">
      {months.map((m) => (
        <li key={m.month} className="bg-card flex flex-col gap-2 rounded-[1.125rem] border p-3.5">
          <span className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-2">
              <strong className="text-base">{m.title}</strong>
              {m.current ? <CurrentTag /> : null}
            </span>
            <MoneyLink
              cents={m.net}
              href={m.href}
              label={`Resultado de ${m.title}`}
              sign={m.net < 0n ? "−" : "+"}
              goes={DETAIL}
              className={cn("font-bold", m.net < 0n ? "text-expense" : "text-income")}
            />
          </span>
          <span role="img" aria-label={ariaOf(m)} className="flex flex-col gap-1">
            <span
              className="bg-income block h-2 rounded"
              style={{ width: percentOf(m.income, max) }}
            />
            <span className="flex h-2">
              <span
                className="bg-expense block rounded-l"
                style={{ width: percentOf(m.fixed, max) }}
              />
              <span
                className="hatch block rounded-r"
                style={
                  {
                    width: percentOf(m.other, max),
                    "--tone": "var(--expense)",
                  } as React.CSSProperties
                }
              />
            </span>
          </span>
          <span className="text-muted-foreground grid grid-cols-3 gap-1.5 text-xs">
            <span className="flex flex-col">
              Entradas
              <MoneyLink
                cents={m.income}
                href={m.href}
                label={`${m.title}, entradas`}
                sign="+"
                goes={DETAIL}
                className="text-income text-[0.8125rem]"
              />
            </span>
            <span className="flex flex-col">
              Fixas
              <MoneyLink
                cents={m.fixed}
                href={m.href}
                label={`${m.title}, despesas fixas`}
                sign="−"
                goes={DETAIL}
                className="text-expense text-[0.8125rem]"
              />
            </span>
            <span className="flex flex-col">
              Faturas
              <MoneyLink
                cents={m.other}
                href={m.href}
                label={`${m.title}, faturas e outras saídas`}
                sign="−"
                goes={DETAIL}
                className="text-expense text-[0.8125rem]"
              />
            </span>
          </span>
          <span className="text-muted-foreground text-xs">
            Acumulado{" "}
            <span className="tabular text-hero-soft-foreground font-mono font-bold">
              {signed(m.cumulative)}
            </span>
          </span>
        </li>
      ))}
    </ul>
  );
}

/** O detalhe de um mês: de onde vem e para onde vai, conta por conta, cada valor com a lista. */
export function CashDetail({
  title,
  rows,
  months,
  current,
}: {
  title: string;
  rows: readonly CashDetailRow[];
  months: readonly CashMonthView[];
  current: string;
}) {
  return (
    <section
      id="detalhe"
      aria-labelledby="detalhe-titulo"
      className="bg-card flex scroll-mt-20 flex-col gap-2.5 rounded-[1.125rem] border p-3.5 md:rounded-[1.25rem] md:px-[1.375rem] md:py-[1.125rem]"
    >
      <h2 id="detalhe-titulo" className="text-[1.0625rem] font-extrabold">
        Entradas e saídas de {title.toLowerCase()}, conta por conta
      </h2>
      <nav
        aria-label="Mês do detalhe"
        className="-mx-1 flex [scrollbar-width:none] gap-1.5 overflow-x-auto px-1"
      >
        {months.map((m) => (
          <Link
            key={m.month}
            href={m.href}
            scroll={false}
            aria-current={m.month === current ? "true" : undefined}
            className={cn(
              "focus-visible:ring-ring inline-flex h-9 shrink-0 items-center rounded-full border px-3.5 text-sm outline-none focus-visible:ring-3",
              m.month === current
                ? "bg-highlight text-highlight-foreground border-transparent font-bold"
                : "bg-card hover:bg-muted font-semibold",
            )}
          >
            {m.title}
          </Link>
        ))}
      </nav>
      {rows.length === 0 ? (
        <p className="text-muted-foreground text-sm">Nada previsto neste mês.</p>
      ) : (
        <ul className="flex flex-col gap-2 text-sm" data-testid="fluxo-detalhe">
          {rows.map((r) => (
            <li key={r.key} className="grid grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-3">
              <span
                aria-hidden
                className={cn(
                  "grid size-8 place-items-center rounded-[0.625rem]",
                  r.key === "recorrencias"
                    ? "bg-chart-4/14 text-chart-4-ink"
                    : "bg-chart-1/14 text-chart-1-ink",
                )}
              >
                {r.key === "recorrencias" ? (
                  <Repeat className="size-4" />
                ) : r.income && !r.expense ? (
                  <ArrowUpRight className="size-4" />
                ) : (
                  <ArrowDownRight className="size-4" />
                )}
              </span>
              <span className="flex min-w-0 flex-col">
                <span className="font-semibold">{r.name}</span>
                <span className="text-muted-foreground text-xs">{r.note}</span>
              </span>
              <span className="flex flex-col items-end">
                {r.income ? (
                  <MoneyLink
                    cents={r.income.cents}
                    href={r.income.href}
                    label={`${r.name}, entradas de ${title.toLowerCase()}`}
                    sign="+"
                    goes={r.key === "recorrencias" ? "Ver as recorrências" : undefined}
                    className="text-income font-bold"
                  />
                ) : null}
                {r.expense ? (
                  <MoneyLink
                    cents={r.expense.cents}
                    href={r.expense.href}
                    label={`${r.name}, saídas de ${title.toLowerCase()}`}
                    sign="−"
                    goes={r.key === "recorrencias" ? "Ver as recorrências" : undefined}
                    className="text-expense font-bold"
                  />
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className="text-muted-foreground text-xs">
        Fatura de cartão: as compras do ciclo que vence neste mês.{" "}
        <Link href="/lancamentos/recorrencias" className={NUMBER_LINK}>
          Recorrências
        </Link>{" "}
        ainda não lançadas entram pelo valor previsto.
      </p>
    </section>
  );
}
