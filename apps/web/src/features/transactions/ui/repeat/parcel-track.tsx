// A linha das parcelas de uma compra (M13.3c, canvas O-Parcelada): as pagas, a desta fatura e as
// previstas (borda tracejada). Uma lista ordenada; o estado de cada uma está escrito, não só na cor.
import { addMonthsToKey, type MonthKey } from "@fintrack/core";
import { cn } from "@/lib/utils";

/** Quantas parcelas a linha mostra no máximo (a desta fatura e as vizinhas). */
const TRACK_MAX = 6;

const monthShort = new Intl.DateTimeFormat("pt-BR", { month: "short", timeZone: "UTC" });
const short = (month: MonthKey) =>
  monthShort.format(new Date(`${month}-15T12:00:00Z`)).replace(".", "");

const STATE = {
  paid: { label: "paga", cell: "bg-muted border", text: "text-income" },
  current: {
    label: "nesta fatura",
    cell: "border-chart-1 border-2 bg-[color-mix(in_srgb,var(--chart-1)_10%,transparent)]",
    text: "text-foreground",
  },
  expected: {
    label: "prevista",
    cell: "bg-card border-[1.5px] border-dashed",
    text: "text-muted-foreground",
  },
} as const;

export function ParcelTrack({
  number,
  count,
  dueMonth,
}: {
  number: number;
  count: number;
  /** O mês do vencimento da fatura da parcela `number` */
  dueMonth: MonthKey;
}) {
  const first = Math.max(1, Math.min(number - 1, count - TRACK_MAX + 1));
  const last = Math.min(count, first + TRACK_MAX - 1);
  const cells = Array.from({ length: last - first + 1 }, (_, i) => first + i);
  return (
    <ol aria-label="As parcelas desta compra" className="flex gap-1.5">
      {cells.map((n) => {
        const state = n < number ? "paid" : n === number ? "current" : "expected";
        const s = STATE[state];
        return (
          <li
            key={n}
            className={cn(
              "flex min-w-0 flex-1 flex-col items-center gap-0.5 rounded-xl px-1 py-2 text-center",
              s.cell,
            )}
          >
            <strong className="tabular font-mono text-[0.9375rem]">
              {n}/{count}
            </strong>
            {/* No celular, só o mês (o canvas O-CelTipo): "fatura de" fica para o leitor de tela */}
            <span className="text-muted-foreground text-xs">
              <span className="max-sm:sr-only">fatura de </span>
              {short(addMonthsToKey(dueMonth, n - number))}
            </span>
            <span className={cn("text-[0.6875rem] leading-tight font-bold sm:text-xs", s.text)}>
              {s.label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
