import Link from "next/link";
import { ChevronRight, CircleCheck, TriangleAlert } from "lucide-react";
import { MoneyLink } from "@/components/money/money-link";
import { percentOf } from "@/lib/chart";
import { formatBRL } from "@/lib/money";
import { NUMBER_LINK } from "@/lib/styles";
import { cn } from "@/lib/utils";
import type { AlertView, CashMonthView } from "../server/queries";

// Os dois blocos da direita do Início (M08, canvas D): orçado × realizado (as categorias acima
// do ritmo, com o ícone e a frase: a cor nunca é o único sinal) e o fluxo de caixa resumido.

/** Um bloco do painel: cartão branco com título (h2) e um link no canto. */
export function Panel({
  id,
  title,
  aside,
  children,
  className,
}: {
  id: string;
  title: string;
  aside?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      aria-labelledby={id}
      className={cn(
        "bg-card flex min-w-0 flex-col gap-3 rounded-[1.125rem] border p-3.5 md:gap-3.5 md:rounded-[1.25rem] md:px-[1.375rem] md:py-5",
        className,
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id={id} className="text-[1.0625rem] font-extrabold tracking-[-0.01em] md:text-xl">
          {title}
        </h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

export function BudgetAlerts({
  alerts,
  withinCount,
  budgetHref,
  compact = false,
}: {
  alerts: readonly AlertView[];
  withinCount: number;
  budgetHref: string;
  /** No celular: um cartão por alerta, que leva ao orçamento (a lista de valores fica lá) */
  compact?: boolean;
}) {
  if (compact) {
    return (
      <ul className="flex flex-col gap-2">
        {alerts.map((a) => (
          <li key={a.key}>
            <Link
              href={a.budget.href}
              className="bg-expense/10 focus-visible:ring-ring grid grid-cols-[1.375rem_minmax(0,1fr)_1.25rem] items-center gap-2.5 rounded-2xl px-3.5 py-3 outline-none focus-visible:ring-3"
            >
              <TriangleAlert aria-hidden className="text-expense size-5" />
              <span className="flex flex-col">
                <strong className="text-[0.9375rem]">
                  {a.categoryName} em {a.walletName}
                </strong>
                <span className="tabular font-mono text-[0.8125rem]">
                  prev. {formatBRL(a.projected.cents)} de {formatBRL(a.budget.cents)}
                </span>
              </span>
              <ChevronRight aria-hidden className="size-[1.125rem]" />
            </Link>
          </li>
        ))}
      </ul>
    );
  }
  return (
    <ul className="flex flex-col gap-2.5" data-testid="alertas">
      {alerts.map((a) => (
        <li
          key={a.key}
          className="bg-expense/10 grid grid-cols-[1.5rem_minmax(0,1fr)] gap-2.5 rounded-[0.875rem] p-3"
        >
          <TriangleAlert aria-hidden className="text-expense mt-0.5 size-5" />
          <span className="flex flex-col gap-0.5">
            <strong className="text-[0.9375rem]">
              {a.categoryName} em {a.walletName}: acima do ritmo
            </strong>
            <span className="text-sm">
              Previsto{" "}
              <MoneyLink
                cents={a.projected.cents}
                href={a.projected.href}
                label={`${a.categoryName}, previsto no mês`}
              />{" "}
              de{" "}
              <Link href={a.budget.href} className={cn(NUMBER_LINK, "tabular font-mono")}>
                {formatBRL(a.budget.cents)}
              </Link>
              ; passa {formatBRL(a.by)}
            </span>
          </span>
        </li>
      ))}
      <li className="bg-muted/50 grid grid-cols-[1.5rem_minmax(0,1fr)] gap-2.5 rounded-[0.875rem] border p-3">
        <CircleCheck aria-hidden className="text-income mt-0.5 size-5" />
        <span className="pt-0.5 text-sm">
          <Link href={budgetHref} className={cn(NUMBER_LINK, "font-semibold")}>
            {withinCount === 1 ? "1 categoria" : `${withinCount} categorias`}
          </Link>{" "}
          dentro do orçado
        </span>
      </li>
    </ul>
  );
}

/** O fluxo de caixa resumido: o resultado de cada mês, com barras de entradas e saídas. */
export function CashFlowMini({
  months,
  limit,
}: {
  months: readonly CashMonthView[];
  limit?: number;
}) {
  const shown = limit ? months.slice(0, limit) : months;
  let max = 0n;
  for (const m of shown) for (const v of [m.income, m.fixed + m.other]) if (v > max) max = v;
  return (
    <ul className="flex flex-col gap-2" data-testid="fluxo-resumo">
      {shown.map((m) => (
        <li
          key={m.month}
          className={cn(
            "grid items-center gap-2.5",
            limit ? "grid-cols-[minmax(0,1fr)_auto]" : "grid-cols-[2.25rem_minmax(0,1fr)_7rem]",
          )}
        >
          <span
            className={cn(
              "text-muted-foreground text-[0.8125rem] font-semibold",
              limit && "text-foreground text-[0.9375rem]",
            )}
          >
            {limit ? m.title : m.abbr}
          </span>
          {limit ? null : (
            <span
              role="img"
              aria-label={`${m.title}: entradas ${formatBRL(m.income)}; despesas fixas ${formatBRL(m.fixed)}; faturas e outras saídas ${formatBRL(m.other)}; resultado ${formatBRL(m.net)}.`}
              className="flex flex-col gap-[3px]"
            >
              <span
                className="bg-income block h-[7px] rounded"
                style={{ width: percentOf(m.income, max) }}
              />
              <span className="flex h-[7px]">
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
          )}
          <Link
            href={m.href}
            aria-label={`Resultado de ${m.title}: ${m.net < 0n ? "−" : "+"} ${formatBRL(m.net < 0n ? -m.net : m.net)}. Ver o detalhe do mês`}
            className={cn(
              NUMBER_LINK,
              "tabular text-right font-mono text-sm font-bold",
              m.net < 0n ? "text-expense" : "text-income",
            )}
          >
            {m.net < 0n ? "−" : "+"} {formatBRL(m.net < 0n ? -m.net : m.net)}
          </Link>
        </li>
      ))}
    </ul>
  );
}
