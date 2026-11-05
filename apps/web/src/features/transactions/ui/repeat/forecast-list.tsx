// As previstas numa lista (M13.3c, ADR-027; pranchas O-FaturaFutura e O-ContaPrevista): o que se
// repete e ainda não chegou e as parcelas que faltam. Borda tracejada e o valor em cinza: ainda
// não é lançamento. Cada uma diz o estado por escrito ("Prevista" ou "Não chegou"), não só pela
// cor. As colunas seguem a largura da lista (@container).
import { CalendarClock, CircleAlert } from "lucide-react";
import { ToneChip } from "@/components/visual/tone-chip";
import { civilDayMonth } from "@/lib/dates";
import { formatBRL } from "@/lib/money";
import { AMOUNT_RULE_NOTE, whenText } from "../../repeat-text";

/** O que a lista precisa de cada prevista (ForecastItem do @fintrack/db). */
export type ForecastRow = {
  key: string;
  source: "recurrence" | "installment";
  title: string;
  bankText: string | null;
  categoryName: string | null;
  date: string;
  amount: bigint;
  state: "expected" | "late";
  installment: { number: number; count: number } | null;
  rule: {
    origin: "APP" | "BANK";
    amountRule: keyof typeof AMOUNT_RULE_NOTE;
    dayRule: "DAY" | "BUSINESS_DAY";
    day: number;
  } | null;
};

function subText(row: ForecastRow) {
  if (row.installment) {
    const left = row.installment.count - row.installment.number;
    const after =
      left === 0
        ? "a última"
        : `depois, ${left === 1 ? "mais 1" : `mais ${left}`} até ${row.installment.count}/${row.installment.count}`;
    return [row.bankText, `vence ${civilDayMonth(row.date)}`, after].filter(Boolean).join(" · ");
  }
  if (!row.rule) return civilDayMonth(row.date);
  return [
    whenText(row.rule.dayRule, row.rule.day),
    row.rule.origin === "BANK" ? AMOUNT_RULE_NOTE[row.rule.amountRule] : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

export function ForecastList({ rows, label }: { rows: readonly ForecastRow[]; label: string }) {
  return (
    <ul aria-label={label} className="@container flex flex-col gap-2">
      {rows.map((row) => {
        const negative = row.amount < 0n;
        const value = `${negative ? "−" : "+"} ${formatBRL(negative ? -row.amount : row.amount)}`;
        return (
          <li
            key={row.key}
            data-testid="prevista"
            className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 rounded-[0.875rem] border-[1.5px] border-dashed px-3 py-2.5 @2xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_9rem_8rem]"
          >
            <div className="min-w-0">
              <p className="font-bold break-words">
                {row.title}
                {row.installment ? (
                  <span className="text-muted-foreground tabular ml-1.5 font-mono text-sm">
                    <span className="sr-only">parcela </span>
                    {row.installment.number}
                    <span aria-hidden>/</span>
                    <span className="sr-only"> de </span>
                    {row.installment.count}
                  </span>
                ) : null}
              </p>
              <p className="text-muted-foreground text-[0.8125rem] break-words">{subText(row)}</p>
            </div>
            <span className="text-muted-foreground tabular justify-self-end font-mono font-bold @2xl:order-4">
              {value}
            </span>
            <span className="text-sm font-semibold break-words @2xl:order-2">
              {row.categoryName ?? "Sem categoria"}
            </span>
            <span className="justify-self-end @2xl:order-3 @2xl:justify-self-start">
              {row.state === "late" ? (
                <ToneChip tone={4} icon={CircleAlert}>
                  Não chegou
                </ToneChip>
              ) : (
                <ToneChip tone={2} icon={CalendarClock}>
                  Prevista
                </ToneChip>
              )}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
