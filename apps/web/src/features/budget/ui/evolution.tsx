import Link from "next/link";
import { ChevronDown, TrendingDown, TrendingUp } from "lucide-react";
import { MoneyLink } from "@/components/money/money-link";
import { percentOf, niceScale } from "@/lib/chart";
import { formatBRL } from "@/lib/money";
import { cn } from "@/lib/utils";
import type { GroupSeriesView, SeriesPoint } from "../server/queries";

// Evolução mês a mês por categoria (M08, canvas D "Evolução"): o gráfico grande da categoria
// escolhida e, embaixo, um cartão pequeno por categoria (cada um na própria escala).
//
// Gráfico grande: barra cheia = gasto do mês; listrada = previsto até o fim do mês de hoje;
// traço preto = orçado do mês; linha tracejada laranja = média de 6 meses. Cada barra é um link
// para os lançamentos daquele mês, com nome completo ("Julho de 2026: R$ 1.468,20, orçado
// R$ 1.400,00, acima do orçado. Ver os lançamentos") e uma dica que aparece no foco e no mouse.

function pointLabel(p: SeriesPoint) {
  const budget = p.budget === null ? "" : `, orçado ${formatBRL(p.budget)}`;
  if (p.current)
    return `${p.title}, em andamento: gasto até hoje ${formatBRL(p.spent)}, previsto ${formatBRL(p.projected)}${budget}. Ver os lançamentos`;
  const over = p.budget !== null && p.spent > p.budget ? ", acima do orçado" : "";
  return `${p.title}: ${formatBRL(p.spent)}${budget}${over}. Ver os lançamentos`;
}

/** O rótulo do eixo: "1.500" (reais, sem centavos). */
const axis = (cents: bigint) =>
  cents === 0n ? "0" : formatBRL(cents).replace("R$", "").replace(",00", "").trim();

export function EvolutionChart({ series }: { series: GroupSeriesView }) {
  const points = series.points;
  let max = series.average6;
  for (const p of points)
    for (const v of [p.spent, p.projected, p.budget ?? 0n]) if (v > max) max = v;
  const { scale, ticks } = niceScale(max);
  const dense = points.length > 12;
  const lastIndex = points.length - 1;
  return (
    <div className="flex flex-col gap-1.5" data-testid="evolucao-grafico">
      <div className="relative mt-2 ml-10 h-[11.875rem] md:ml-16 md:h-[16.875rem]">
        {ticks.map((t) => (
          <span
            key={t.toString()}
            aria-hidden
            className="absolute inset-x-0 border-t"
            style={{ bottom: percentOf(t, scale) }}
          >
            <span className="tabular text-muted-foreground absolute -top-2 right-[calc(100%+0.375rem)] font-mono text-[0.6875rem] md:-top-[0.5625rem] md:right-[calc(100%+0.625rem)] md:text-xs">
              {axis(t)}
            </span>
          </span>
        ))}
        {series.average6 > 0n ? (
          <span
            aria-hidden
            className="border-chart-4 absolute inset-x-0 z-[2] border-t-2 border-dashed"
            style={{ bottom: percentOf(series.average6, scale) }}
          >
            <span className="tabular bg-card text-chart-4-ink absolute -top-6 right-0 hidden rounded-md px-1.5 py-px font-mono text-xs font-semibold md:block">
              média {formatBRL(series.average6)}
            </span>
          </span>
        ) : null}
        <ol
          className={cn("absolute inset-0 grid gap-1 md:px-1.5", dense ? "md:gap-1" : "md:gap-2.5")}
          style={{ gridTemplateColumns: `repeat(${points.length}, minmax(0, 1fr))` }}
        >
          {points.map((p, i) => {
            const rest = p.current ? p.projected - p.spent : 0n;
            const over = p.budget !== null && (p.current ? p.projected : p.spent) > p.budget;
            return (
              <li key={p.month} className="h-full">
                <Link
                  href={p.href}
                  aria-label={pointLabel(p)}
                  data-month={p.month}
                  data-cents={p.spent.toString()}
                  className={cn(
                    "group focus-visible:ring-ring relative flex h-full flex-col-reverse rounded-t-md px-0.5 outline-none focus-visible:ring-3",
                    !dense && "md:px-[0.3125rem]",
                  )}
                >
                  <span
                    className={cn(
                      "bg-chart-1 block",
                      rest > 0n ? "" : "rounded-t-[3px] md:rounded-t",
                    )}
                    style={{ height: percentOf(p.spent, scale) }}
                  />
                  {rest > 0n ? (
                    <span
                      className="hatch block rounded-t-[3px] md:rounded-t"
                      style={{ height: percentOf(rest, scale) }}
                    />
                  ) : null}
                  {p.budget !== null ? (
                    <span
                      aria-hidden
                      className="bg-foreground absolute -inset-x-px z-[3] -mb-px h-[3px] rounded-full shadow-[0_0_0_1px_var(--card)] md:-inset-x-0.5 md:shadow-[0_0_0_2px_var(--card)]"
                      style={{ bottom: percentOf(p.budget, scale) }}
                    />
                  ) : null}
                  <span
                    aria-hidden
                    className={cn(
                      "bg-foreground text-background pointer-events-none invisible absolute z-[5] flex w-[13.125rem] flex-col gap-0.5 rounded-xl px-3 py-2.5 text-[0.8125rem] shadow-[0_14px_30px_-12px_rgb(10_13_40/0.5)] group-hover:visible group-focus-visible:visible",
                      i < points.length / 2 ? "left-0" : "right-0",
                    )}
                    style={{ bottom: `calc(${percentOf(p.projected, scale)} + 0.875rem)` }}
                  >
                    <strong>{p.title}</strong>
                    <span className="tabular font-mono">
                      {p.current ? "Até hoje" : "Gasto"} {formatBRL(p.spent)}
                    </span>
                    {p.current ? (
                      <span className="tabular font-mono">Previsto {formatBRL(p.projected)}</span>
                    ) : null}
                    {p.budget !== null ? (
                      <span className="tabular font-mono">
                        Orçado {formatBRL(p.budget)}
                        {over ? " · acima" : ""}
                      </span>
                    ) : null}
                    <span>Clique para ver os lançamentos</span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ol>
      </div>
      <div
        aria-hidden
        className={cn("ml-10 grid gap-1 md:ml-16 md:px-1.5", dense ? "md:gap-1" : "md:gap-2.5")}
        style={{ gridTemplateColumns: `repeat(${points.length}, minmax(0, 1fr))` }}
      >
        {points.map((p, i) => (
          <span
            key={p.month}
            className={cn(
              "text-muted-foreground text-center text-[0.625rem] font-semibold md:text-[0.8125rem]",
              // 24 meses no celular: um rótulo sim, outro não (o de hoje sempre aparece)
              dense && (lastIndex - i) % 2 === 1 && "invisible md:visible",
            )}
          >
            {p.abbr}
          </span>
        ))}
      </div>
    </div>
  );
}

/** A mesma série escrita (alternativa ao gráfico): mês, gasto, orçado e situação. */
export function EvolutionTable({ series }: { series: GroupSeriesView }) {
  return (
    <div className="overflow-x-auto rounded-[0.875rem] border">
      <table className="w-full min-w-[30rem] border-collapse text-sm" data-testid="evolucao-tabela">
        <caption className="text-muted-foreground px-3.5 py-2.5 text-left text-[0.8125rem]">
          {series.name}, mês a mês. Cada valor leva aos lançamentos do mês.
        </caption>
        <thead>
          <tr className="bg-muted/60 text-muted-foreground text-xs tracking-[0.03em] uppercase">
            <th scope="col" className="px-3.5 py-2 text-left">
              Mês
            </th>
            <th scope="col" className="px-3.5 py-2 text-right">
              Gasto
            </th>
            <th scope="col" className="px-3.5 py-2 text-right">
              Previsto
            </th>
            <th scope="col" className="px-3.5 py-2 text-right">
              Orçado
            </th>
            <th scope="col" className="px-3.5 py-2 text-left">
              Situação
            </th>
          </tr>
        </thead>
        <tbody>
          {series.points.toReversed().map((p) => {
            const value = p.current ? p.projected : p.spent;
            const status =
              p.budget === null
                ? "Sem orçado"
                : value > p.budget
                  ? "Acima do orçado"
                  : "Dentro do orçado";
            return (
              <tr key={p.month} className="border-t">
                <th scope="row" className="px-3.5 py-2.5 text-left font-semibold">
                  {p.title} {p.month.slice(0, 4)}
                  {p.current ? (
                    <span className="text-muted-foreground font-normal"> (em andamento)</span>
                  ) : null}
                </th>
                <td className="px-3.5 py-2.5 text-right">
                  <MoneyLink
                    cents={p.spent}
                    href={p.href}
                    label={`${series.name}, ${p.title}, gasto`}
                  />
                </td>
                <td className="tabular px-3.5 py-2.5 text-right font-mono">
                  {p.current ? formatBRL(p.projected) : "—"}
                </td>
                <td className="tabular px-3.5 py-2.5 text-right font-mono">
                  {p.budget === null ? "—" : formatBRL(p.budget)}
                </td>
                <td
                  className={cn(
                    "px-3.5 py-2.5",
                    status === "Acima do orçado" && "text-expense font-semibold",
                  )}
                >
                  {status}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** "12 % acima da média de 6 meses", com a seta (a cor nunca é o único sinal). */
function Delta({ versus, small = false }: { versus: bigint | null; small?: boolean }) {
  const Icon =
    versus !== null && versus > 0n
      ? TrendingUp
      : versus !== null && versus < 0n
        ? TrendingDown
        : null;
  const text =
    versus === null
      ? "sem média de 6 meses"
      : versus === 0n
        ? "igual à média de 6 meses"
        : `${versus < 0n ? -versus : versus} % ${versus > 0n ? "acima" : "abaixo"} da média de 6 meses`;
  return (
    <span
      className={cn(
        "text-muted-foreground flex items-start gap-1.5",
        small ? "text-xs" : "text-[0.8125rem]",
      )}
    >
      {Icon ? (
        <Icon
          aria-hidden
          className={cn("text-foreground shrink-0", small ? "size-3.5" : "size-[0.9375rem]")}
        />
      ) : null}
      {text}
    </span>
  );
}

/** Os cartões pequenos: um por categoria, cada um na própria escala. Escolher leva ao de cima. */
export function EvolutionMultiples({
  multiples,
  currentTitle,
}: {
  multiples: readonly GroupSeriesView[];
  /** "outubro" */
  currentTitle: string;
}) {
  return (
    <ul
      className="grid grid-cols-2 gap-2.5 md:grid-cols-3 md:gap-3"
      data-testid="evolucao-categorias"
    >
      {multiples.map((m) => {
        let max = 0n;
        for (const p of m.points) if (p.projected > max) max = p.projected;
        const now = m.points.at(-1);
        return (
          <li key={m.groupId} className="flex">
            <Link
              href={`${m.href}#grafico`}
              scroll={false}
              aria-current={m.current ? "true" : undefined}
              aria-label={`${m.name}: ${currentTitle}, previsto ${formatBRL(now?.projected ?? 0n)}. Ver no gráfico de cima`}
              className={cn(
                "bg-card focus-visible:ring-ring flex w-full flex-col gap-2 rounded-2xl p-3 outline-none focus-visible:ring-3 md:gap-2.5 md:rounded-[1.125rem] md:px-4 md:py-3.5",
                m.current ? "border-chart-1 border-2" : "border",
              )}
            >
              <span className="flex flex-col justify-between gap-2 md:flex-row md:items-baseline">
                <span className="flex flex-col">
                  <strong className="text-sm md:text-[0.9375rem]">{m.name}</strong>
                  <span className="text-muted-foreground hidden text-xs md:block">{m.wallets}</span>
                </span>
                <span className="flex flex-col md:items-end">
                  <span className="text-muted-foreground hidden text-xs md:block">
                    {currentTitle}, prev.
                  </span>
                  <span className="tabular font-mono text-[0.8125rem] font-bold md:text-[0.9375rem]">
                    {formatBRL(now?.projected ?? 0n)}
                  </span>
                </span>
              </span>
              <span
                aria-hidden
                className="grid h-10 items-end gap-0.5 border-b md:h-14 md:gap-[3px]"
                style={{ gridTemplateColumns: `repeat(${m.points.length}, minmax(0, 1fr))` }}
              >
                {m.points.map((p) => (
                  <span key={p.month} className="flex h-full flex-col-reverse">
                    <span
                      className="bg-chart-1 block rounded-t-[2px]"
                      style={{ height: percentOf(p.spent, max) }}
                    />
                    {p.current && p.projected > p.spent ? (
                      <span
                        className="hatch block rounded-t-[2px]"
                        style={{ height: percentOf(p.projected - p.spent, max) }}
                      />
                    ) : null}
                  </span>
                ))}
              </span>
              <Delta versus={m.versusAverage} small />
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

/** Escolher a categoria do gráfico de cima: um botão que abre a lista (links, sem JavaScript). */
export function CategoryPicker({
  current,
  currentId,
  options,
  className,
}: {
  current: string;
  currentId: string;
  options: readonly { id: string; name: string; href: string }[];
  className?: string;
}) {
  return (
    // key: trocar de categoria recria o menu (fechado)
    <details key={current} className={cn("group/picker relative", className)}>
      <summary className="bg-card focus-visible:ring-ring flex h-11 cursor-pointer list-none items-center justify-between gap-2 rounded-xl border px-3.5 text-sm font-semibold outline-none focus-visible:ring-3 md:h-[2.625rem] [&::-webkit-details-marker]:hidden">
        Categoria: {current}
        <ChevronDown
          aria-hidden
          className="size-4 transition-transform group-open/picker:rotate-180"
        />
      </summary>
      <ul className="bg-card absolute top-[calc(100%+0.375rem)] left-0 z-20 flex max-h-80 min-w-full flex-col overflow-y-auto rounded-xl border p-1 shadow-[0_18px_40px_-16px_rgb(10_13_40/0.35)]">
        {options.map((o) => (
          <li key={o.id}>
            <Link
              href={o.href}
              scroll={false}
              aria-current={o.id === currentId ? "true" : undefined}
              className={cn(
                "hover:bg-muted focus-visible:ring-ring flex h-10 items-center rounded-lg px-3 text-sm whitespace-nowrap outline-none focus-visible:ring-3",
                o.id === currentId ? "font-bold" : "font-medium",
                o.name.includes("›") && "pl-6",
              )}
            >
              {o.name}
            </Link>
          </li>
        ))}
      </ul>
    </details>
  );
}

export { Delta };
