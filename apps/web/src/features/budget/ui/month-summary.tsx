// O resumo do mês (M10.3, pranchas F-Resumo, F3-Resumo, F3-Fechado, F3-Pouco e F3-CelFechado):
// até três observações calculadas por regras, sem IA, cada número levando aos lançamentos que o
// formam. Do dia 1 ao 5, o mês anterior, fechado, com o selo "Mês fechado".
//
//   ┌ Resumo de outubro ──────────────── Com os lançamentos confirmados até agora ┐
//   │ [!] Mercado, no ambiente Casa, deve passar do orçado                         │
//   │     Previsto R$ 1.661,43 de R$ 1.400,00: passa R$ 261,43                     │
//   │ [↗] Restaurantes acima do costume ...   [+] Uma assinatura nova ...          │
//   └──────────────────────────────────────────────────────────────────────────────┘
//
// O ícone e a cor reforçam o tipo; o título diz o tipo em palavras (a cor nunca é o único sinal).
import { Check, Plus, TrendingUp, TriangleAlert, type LucideIcon } from "lucide-react";
import type { SummaryView } from "../server/queries";
import { MoneyLink } from "@/components/money/money-link";
import { cn } from "@/lib/utils";

const KIND: Record<
  SummaryView["observations"][number]["kind"],
  { icon: LucideIcon; tile: string }
> = {
  OVER_BUDGET: {
    icon: TriangleAlert,
    tile: "bg-[color-mix(in_srgb,var(--expense)_14%,transparent)] text-expense",
  },
  ABOVE_USUAL: {
    icon: TrendingUp,
    tile: "bg-[color-mix(in_srgb,var(--chart-4)_14%,transparent)] text-chart-4-ink",
  },
  NEW_RECURRING: {
    icon: Plus,
    tile: "bg-[color-mix(in_srgb,var(--chart-1)_14%,transparent)] text-chart-1-ink",
  },
};

/** Para onde cada link leva, dito no fim do nome acessível. */
const goesFor = (href: string) =>
  href.startsWith("/orcamento")
    ? "Ver o orçamento"
    : href.startsWith("/lancamentos/recorrencias")
      ? "Ver as contas fixas"
      : "Ver os lançamentos";

type Segment = SummaryView["observations"][number]["segments"][number];

/**
 * Os parênteses ficam colados no número: "(R$ 300,00)" nunca quebra a linha entre o "(" e o
 * valor. O "(" do fim de um texto e o ")" do começo do seguinte vão junto com o número.
 */
function glued(segments: readonly Segment[]): Segment[][] {
  const out: Segment[][] = [];
  for (let i = 0; i < segments.length; i++) {
    const s = segments[i] as Segment;
    if ("text" in s) {
      out.push([s]);
      continue;
    }
    const group: Segment[] = [s];
    const before = out.at(-1)?.[0];
    if (before && "text" in before && before.text.endsWith("(")) {
      out.pop();
      out.push([{ text: before.text.slice(0, -1) }]);
      group.unshift({ text: "(" });
    }
    const after = segments[i + 1];
    if (after && "text" in after && after.text.startsWith(")")) {
      group.push({ text: ")" });
      segments = [
        ...segments.slice(0, i + 1),
        { text: after.text.slice(1) },
        ...segments.slice(i + 2),
      ];
    }
    out.push(group);
  }
  return out.filter((g) => !(g.length === 1 && "text" in g[0]! && g[0].text === ""));
}

export function MonthSummary({ summary }: { summary: SummaryView }) {
  return (
    <section
      aria-labelledby="resumo-do-mes"
      data-testid="resumo-do-mes"
      data-month={summary.month}
      className="bg-card flex flex-col gap-3 rounded-[1.25rem] border p-4 md:gap-3.5 md:px-[1.375rem] md:py-5"
    >
      <div className="flex flex-col gap-0.5 md:flex-row md:flex-wrap md:items-baseline md:justify-between md:gap-3">
        <h2 id="resumo-do-mes" className="text-xl font-extrabold tracking-[-0.01em]">
          {summary.title}
        </h2>
        <span className="text-muted-foreground text-xs md:text-[0.8125rem]">
          {summary.subtitle}
        </span>
      </div>
      {summary.closed ? (
        <span className="bg-muted text-muted-foreground inline-flex h-[1.625rem] items-center gap-1.5 self-start rounded-full px-2.5 text-[0.8125rem] font-bold">
          <Check aria-hidden className="size-3.5" />
          Mês fechado
        </span>
      ) : null}
      {summary.observations.length > 0 ? (
        <ol
          className={cn(
            "grid gap-2.5 md:gap-3",
            summary.observations.length === 3 && "md:grid-cols-3",
            summary.observations.length === 2 && "md:grid-cols-2",
          )}
        >
          {summary.observations.map((o) => {
            const kind = KIND[o.kind];
            const Icon = kind.icon;
            return (
              <li
                key={o.key}
                data-kind={o.kind}
                className="bg-muted/50 grid grid-cols-[2.25rem_minmax(0,1fr)] gap-3 rounded-2xl border p-3.5 md:grid-cols-[2.5rem_minmax(0,1fr)]"
              >
                <span
                  aria-hidden
                  className={cn("grid size-9 place-items-center rounded-xl md:size-10", kind.tile)}
                >
                  <Icon className="size-5" />
                </span>
                <span className="flex min-w-0 flex-col gap-1">
                  <strong className="text-[0.9375rem]">{o.title}</strong>
                  <span className="text-sm leading-6">
                    {glued(o.segments).map((group, i) => (
                      <span key={i} className={group.length > 1 ? "whitespace-nowrap" : undefined}>
                        {group.map((s, j) =>
                          "text" in s ? (
                            <span key={j}>{s.text}</span>
                          ) : (
                            <MoneyLink
                              key={j}
                              cents={s.cents}
                              href={s.href}
                              label={o.title}
                              goes={goesFor(s.href)}
                              className={cn(
                                s.emphasis === "strong" && "font-bold",
                                s.emphasis === "expense" && "text-expense font-bold",
                              )}
                            />
                          ),
                        )}
                      </span>
                    ))}
                  </span>
                </span>
              </li>
            );
          })}
        </ol>
      ) : null}
      <p className="text-muted-foreground text-[0.8125rem]">
        {summary.missing ??
          "Três observações, escolhidas pelo maior valor em reais, no máximo uma por categoria. Cada número leva aos lançamentos que o formam."}
      </p>
    </section>
  );
}
