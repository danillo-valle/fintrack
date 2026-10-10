import { cn } from "@/lib/utils";

export type LegendMark = "bar" | "hatch" | "diamond" | "tick" | "dash" | "line";

// Legenda de gráfico (M08): cada marca com o nome escrito ao lado (a cor nunca é o único sinal).
// "bar" cheio = já aconteceu; "hatch" listrado = previsto; losango = mês passado; traço laranja
// = média de 6 meses; "tick" = orçado; "dash" = linha de referência tracejada.
export function ChartLegend({
  items,
  className,
}: {
  items: {
    label: string;
    /** Rótulo curto no celular ("Previsto" no lugar de "Previsto até o fim de outubro") */
    shortLabel?: string;
    mark: LegendMark;
    tone?: "chart-1" | "income" | "expense";
  }[];
  className?: string;
}) {
  return (
    <ul
      aria-label="Legenda"
      className={cn(
        "text-muted-foreground flex flex-wrap gap-x-4 gap-y-1.5 text-[0.8125rem]",
        className,
      )}
    >
      {items.map((item) => (
        <li key={item.label} className="flex items-center gap-1.5">
          <LegendSwatch mark={item.mark} tone={item.tone ?? "chart-1"} />
          {item.shortLabel ? (
            <>
              <span className="md:hidden">{item.shortLabel}</span>
              <span className="hidden md:inline">{item.label}</span>
            </>
          ) : (
            item.label
          )}
        </li>
      ))}
    </ul>
  );
}

const TONE = { "chart-1": "var(--chart-1)", income: "var(--income)", expense: "var(--expense)" };

export function LegendSwatch({
  mark,
  tone = "chart-1",
}: {
  mark: LegendMark;
  tone?: keyof typeof TONE;
}) {
  const style = { "--tone": TONE[tone] } as React.CSSProperties;
  switch (mark) {
    case "bar":
      return (
        <span aria-hidden style={style} className="h-2.5 w-3.5 rounded-[3px] bg-[var(--tone)]" />
      );
    case "hatch":
      return <span aria-hidden style={style} className="hatch h-2.5 w-3.5 rounded-[3px]" />;
    case "diamond":
      return <span aria-hidden className="bg-foreground size-2 rotate-45" />;
    case "tick":
      return <span aria-hidden className="bg-foreground h-[3px] w-4 rounded-full" />;
    case "line":
      return <span aria-hidden className="bg-chart-4 h-3.5 w-[3px] rounded-full" />;
    case "dash":
      return <span aria-hidden className="border-chart-4 w-[1.125rem] border-t-2 border-dashed" />;
  }
}
