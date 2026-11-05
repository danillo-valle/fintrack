// O Período e o Pago por como combos de marcar (M13.3a, pranchas N-Cabecalho e N-CabecalhoPagoPor).
//
// Cada combo é um formulário GET: as caixas marcadas vão para a URL (`?mes=…&mes=…`,
// `?pago=…&pago=…`) e o resto da lista (conta, ambiente, categoria, busca) vai junto em campos
// escondidos, para trocar o período não perder o filtro. Os atalhos (Este mês, Mês passado,
// Últimos 3 meses; Todos) são links.
import Link from "next/link";
import { payerParam, type CivilDate } from "@fintrack/core";
import { CheckCombo, CheckComboFooter, CheckRow } from "@/components/visual/check-combo";
import { cn } from "@/lib/utils";
import type { PayerOption } from "../payers";
import { monthName, periodChoices, periodPresets, periodShort } from "../presentation";
import { filtersToQuery, type ParsedFilters } from "../schemas";
import { PayerTile } from "./payer-tile";

const SHORTCUT =
  "focus-visible:ring-ring hover:bg-muted flex min-h-11 items-center rounded-xl px-2.5 text-[0.9375rem] font-semibold outline-none focus-visible:ring-3 aria-[current=true]:bg-muted";

/** Os outros filtros da lista em campos escondidos (menos os que o combo escreve). */
export function KeepParams({
  parsed,
  drop,
}: {
  parsed: ParsedFilters;
  /** Os parâmetros que o formulário escreve: não vão escondidos */
  drop: readonly string[];
}) {
  const query = new URLSearchParams(filtersToQuery(parsed));
  return (
    <>
      {[...query.entries()]
        .filter(([key]) => !drop.includes(key))
        .map(([key, value], index) => (
          <input key={`${key}-${index}`} type="hidden" name={key} value={value} />
        ))}
    </>
  );
}

export function PeriodCombo({
  parsed,
  action,
  today,
}: {
  parsed: ParsedFilters;
  /** A página da lista (/lancamentos) */
  action: string;
  today: CivilDate;
}) {
  const { period } = parsed.filters;
  const marked = new Set(period.kind === "months" ? period.months : []);
  const choices = periodChoices(today);
  const years = [...new Set(choices.map((m) => m.slice(0, 4)))];
  const href = (months: readonly string[]) =>
    `${action}?${filtersToQuery(parsed, { mes: months, cursor: null, cursorCartoes: null })}`;
  const sameMonths = (months: readonly string[]) =>
    period.kind === "months" &&
    months.length === period.months.length &&
    months.every((m) => marked.has(m));

  return (
    <CheckCombo
      label="Período"
      value={periodShort(period, today)}
      count={marked.size}
      selection={period.kind === "months" ? period.months.join(",") : `${period.from}:${period.to}`}
    >
      <nav aria-label="Atalhos de período" className="flex flex-col border-b pb-2">
        {periodPresets(today).map((p) => (
          <Link
            key={p.label}
            href={href(p.months)}
            aria-current={sameMonths(p.months) ? "true" : undefined}
            className={SHORTCUT}
          >
            {p.label}
          </Link>
        ))}
      </nav>
      <form method="get" action={action} className="flex flex-col gap-1 pt-2">
        <KeepParams parsed={parsed} drop={["mes", "de", "ate", "cursor", "cursorCartoes"]} />
        {years.map((year) => (
          <fieldset key={year} className="flex flex-col">
            <legend className="text-muted-foreground px-2.5 pt-1 pb-1 text-xs font-bold">
              {year}
            </legend>
            {choices
              .filter((m) => m.startsWith(year))
              .map((month) => (
                <CheckRow key={month} name="mes" value={month} checked={marked.has(month)}>
                  <span className="font-semibold">{monthName(month)}</span>
                  {month === choices[0] ? (
                    <span className="text-muted-foreground text-xs">em andamento</span>
                  ) : null}
                </CheckRow>
              ))}
          </fieldset>
        ))}
        <CheckComboFooter />
      </form>
    </CheckCombo>
  );
}

export function PayerCombo({
  parsed,
  action,
  payers,
}: {
  parsed: ParsedFilters;
  action: string;
  payers: readonly PayerOption[];
}) {
  const marked = new Set(parsed.filters.payers.map(payerParam));
  const names = payers.filter((p) => marked.has(p.param)).map((p) => p.name);
  const value =
    names.length === 0 ? "Todos" : names.length <= 2 ? names.join(", ") : `${names.length} pessoas`;
  return (
    <CheckCombo
      label="Pago por"
      value={value}
      count={names.length}
      selection={[...marked].join(",")}
    >
      <form method="get" action={action} className="flex flex-col gap-1">
        <KeepParams parsed={parsed} drop={["pago", "cursor", "cursorCartoes"]} />
        <Link
          href={`${action}?${filtersToQuery(parsed, { pago: null, cursor: null, cursorCartoes: null })}`}
          aria-current={marked.size === 0 ? "true" : undefined}
          className={cn(SHORTCUT, "border-b")}
        >
          Todos
        </Link>
        {payers.map((payer) => (
          <CheckRow
            key={payer.param}
            name="pago"
            value={payer.param}
            checked={marked.has(payer.param)}
          >
            <PayerTile payer={payer} className="size-8 rounded-lg text-xs" />
            <span className="font-semibold">{payer.name}</span>
          </CheckRow>
        ))}
        <CheckComboFooter />
      </form>
    </CheckCombo>
  );
}
