import Link from "next/link";
import { percentVersus } from "@fintrack/core";
import { MoneyLink } from "@/components/money/money-link";
import { ChartLegend } from "@/components/visual/chart-legend";
import { percentOf } from "@/lib/chart";
import { formatBRL } from "@/lib/money";
import { NUMBER_LINK } from "@/lib/styles";
import { cn } from "@/lib/utils";
import type { GroupView } from "../server/queries";

// Gasto por categoria (Início, M08, canvas D): uma linha por grupo (categoria de primeiro nível).
// A barra cheia é o gasto até hoje; a listrada, o previsto até o fim do mês; o losango, o mês
// passado; o traço laranja, a média de 6 meses. Todos na mesma escala (o maior valor da tela).
// O nome leva à evolução do grupo; cada valor, aos lançamentos que o compõem. A versão em
// tabela (?ver=tabela) mostra os mesmos números escritos.

const LEGEND = [
  { label: "Gasto até hoje", mark: "bar" as const },
  { label: "Previsto até o fim do mês", mark: "hatch" as const },
  { label: "Mês passado", mark: "diamond" as const },
  { label: "Média de 6 meses", mark: "line" as const },
];

function scaleOf(groups: readonly GroupView[]) {
  let max = 0n;
  for (const g of groups) {
    for (const v of [g.projected.cents, g.lastMonth.cents, g.average.cents]) if (v > max) max = v;
  }
  return (max * 105n) / 100n;
}

/** No celular, as 6 primeiras (canvas D); o resto fica em "Ver as N categorias". */
const MOBILE_LIMIT = 6;

export function GroupSpendingChart({
  groups,
  allHref,
}: {
  groups: readonly GroupView[];
  /** Onde ver todas (a Evolução, com um cartão por categoria) */
  allHref: string;
}) {
  const scale = scaleOf(groups);
  return (
    <div className="flex flex-col gap-3.5">
      <ChartLegend items={LEGEND} />
      <ul className="flex flex-col" data-testid="gasto-por-categoria">
        {groups.map((g) => {
          const real = percentOf(g.spent.cents, scale);
          const rest = percentOf(g.projected.cents - g.spent.cents, scale);
          return (
            <li
              key={g.groupId ?? "sem"}
              data-group={g.groupId ?? "sem"}
              className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3.5 gap-y-1.5 border-t py-2.5 first:border-t-0 md:grid-cols-[8.25rem_minmax(0,1fr)_8rem] max-md:[&:nth-child(n+7)]:hidden"
            >
              <span className="flex min-w-0 flex-col">
                <Link
                  href={g.evolutionHref}
                  className={cn(NUMBER_LINK, "truncate text-[0.9375rem] font-semibold")}
                >
                  {g.name}
                </Link>
                <span className="text-muted-foreground hidden truncate text-xs md:block">
                  {g.wallets}
                </span>
              </span>
              <span
                role="img"
                aria-label={`${g.name}: gasto até hoje ${formatBRL(g.spent.cents)}; previsto até o fim do mês ${formatBRL(g.projected.cents)}; mês passado ${formatBRL(g.lastMonth.cents)}; média de 6 meses ${formatBRL(g.average.cents)}.`}
                className="bg-muted relative col-span-2 block h-3.5 rounded-[5px] md:col-span-1 md:col-start-2 md:row-start-1 md:h-5 md:rounded-md"
              >
                <span
                  className="bg-chart-1 absolute inset-y-0 left-0 rounded-l-[inherit]"
                  style={{ width: real }}
                />
                <span
                  className="hatch absolute inset-y-0 rounded-r-[inherit]"
                  style={{ left: real, width: rest }}
                />
                <span
                  className="bg-chart-4 absolute -inset-y-1 -ml-px w-[3px] rounded-full"
                  style={{ left: percentOf(g.average.cents, scale) }}
                />
                <span
                  className="bg-foreground border-card absolute top-1/2 -mt-1.5 -ml-1.5 size-[0.6875rem] rotate-45 border-2"
                  style={{ left: percentOf(g.lastMonth.cents, scale) }}
                />
              </span>
              <span className="col-start-2 row-start-1 flex items-baseline justify-end gap-1.5 md:col-start-3 md:flex-col md:items-end md:gap-0">
                <MoneyLink
                  cents={g.spent.cents}
                  href={g.spent.href}
                  label={`${g.name}, gasto até hoje`}
                  className="text-[0.9375rem] font-bold"
                  data-testid="grupo-gasto"
                />
                <span className="text-muted-foreground text-xs">
                  <span aria-hidden className="md:hidden">
                    →{" "}
                  </span>
                  <span className="hidden md:inline">prev. </span>
                  <MoneyLink
                    cents={g.projected.cents}
                    href={g.projected.href}
                    label={`${g.name}, previsto até o fim do mês`}
                  />
                </span>
              </span>
            </li>
          );
        })}
      </ul>
      {groups.length > MOBILE_LIMIT ? (
        <Link href={allHref} className={cn(NUMBER_LINK, "w-fit text-sm font-semibold md:hidden")}>
          Ver as {groups.length} categorias
        </Link>
      ) : null}
    </div>
  );
}

/** A mesma informação em tabela, com o mês passado e a média escritos (alternativa ao gráfico). */
export function GroupSpendingTable({ groups }: { groups: readonly GroupView[] }) {
  return (
    <div className="overflow-x-auto rounded-[0.875rem] border">
      <table className="w-full min-w-[40rem] border-collapse text-sm">
        <caption className="text-muted-foreground px-3.5 py-2.5 text-left text-[0.8125rem]">
          Gasto por categoria no mês. Cada valor leva aos lançamentos que o compõem.
        </caption>
        <thead>
          <tr className="bg-muted/60 text-muted-foreground text-xs tracking-[0.03em] uppercase">
            <th scope="col" className="px-3.5 py-2 text-left">
              Categoria
            </th>
            <th scope="col" className="px-3.5 py-2 text-right">
              Gasto até hoje
            </th>
            <th scope="col" className="px-3.5 py-2 text-right">
              Previsto
            </th>
            <th scope="col" className="px-3.5 py-2 text-right">
              Mês passado
            </th>
            <th scope="col" className="px-3.5 py-2 text-right">
              Média de 6 meses
            </th>
            <th scope="col" className="px-3.5 py-2 text-right">
              Previsto × média
            </th>
          </tr>
        </thead>
        <tbody>
          {groups.map((g) => {
            const pct = percentVersus(g.projected.cents, g.average.cents);
            return (
              <tr key={g.groupId ?? "sem"} className="border-t">
                <th scope="row" className="px-3.5 py-2.5 text-left font-semibold">
                  <Link href={g.evolutionHref} className={NUMBER_LINK}>
                    {g.name}
                  </Link>
                </th>
                <td className="px-3.5 py-2.5 text-right">
                  <MoneyLink
                    cents={g.spent.cents}
                    href={g.spent.href}
                    label={`${g.name}, gasto até hoje`}
                  />
                </td>
                <td className="px-3.5 py-2.5 text-right">
                  <MoneyLink
                    cents={g.projected.cents}
                    href={g.projected.href}
                    label={`${g.name}, previsto`}
                  />
                </td>
                <td className="px-3.5 py-2.5 text-right">
                  <MoneyLink
                    cents={g.lastMonth.cents}
                    href={g.lastMonth.href}
                    label={`${g.name}, mês passado`}
                  />
                </td>
                <td className="px-3.5 py-2.5 text-right">
                  <MoneyLink
                    cents={g.average.cents}
                    href={g.average.href}
                    label={`${g.name}, média de 6 meses (os 6 meses somam ${formatBRL(g.average.total)})`}
                  />
                </td>
                <td className="tabular px-3.5 py-2.5 text-right font-mono">
                  {pct === null
                    ? "—"
                    : `${pct > 0n ? "+" : pct < 0n ? "−" : ""}${pct < 0n ? -pct : pct} %`}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
