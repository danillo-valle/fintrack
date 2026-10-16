import Link from "next/link";
import { ChevronLeft, X } from "lucide-react";
import {
  dayOfMonth,
  firstDayOf,
  monthOf,
  payerParam,
  todayCivil,
  type CivilDate,
} from "@fintrack/core";
import { SOURCE_LABEL } from "@/lib/labels";
import { NUMBER_LINK } from "@/lib/styles";
import { cn } from "@/lib/utils";
import type { PayerOption } from "../payers";
import { filtersToQuery, type ParsedFilters } from "../schemas";

// O caminho de volta e os filtros ativos da lista (M08, canvas D "Drill-down"). Quem chega à
// lista por um número do painel vê "Voltar para Orçamento · Mercado" e os filtros que formaram o
// número, cada um com um × para tirar. A soma da lista é a mesma do número clicado.

type Option = { id: string; name: string };

const monthYear = new Intl.DateTimeFormat("pt-BR", {
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});
const TYPE_LABEL = { expense: "Só despesas", income: "Só receitas", transfer: "Só transferências" };

/** "Outubro de 2026" quando o período é um mês inteiro; senão, "01/10 a 09/10/2026". */
function periodLabel(from: CivilDate, to: CivilDate) {
  const month = monthOf(from);
  if (from === firstDayOf(month) && to === dayOfMonth(month, 31)) {
    const text = monthYear.format(new Date(`${from}T12:00:00Z`));
    return text.charAt(0).toUpperCase() + text.slice(1);
  }
  const short = (d: CivilDate) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
  return `${short(from)} a ${short(to)}/${to.slice(0, 4)}`;
}

/** Para onde o "Voltar" leva, pelo nome da tela. */
function backName(back: string) {
  const path = back.split("?")[0];
  if (path === "/orcamento/fluxo") return "Fluxo de caixa";
  if (path === "/orcamento/evolucao") return "Evolução";
  if (path === "/orcamento") return "Orçamento";
  if (path === "/ajustes/categorizacao") return "Categorização";
  return "Início";
}

export function BackLink({ parsed, categories }: { parsed: ParsedFilters; categories: Option[] }) {
  if (!parsed.back) return null;
  const category =
    parsed.filters.categoryId === "none"
      ? "Sem categoria"
      : categories.find((c) => c.id === parsed.filters.categoryId)?.name;
  const label = `${backName(parsed.back)}${category ? ` · ${category}` : ""}`;
  return (
    <Link
      href={parsed.back}
      className={cn(
        NUMBER_LINK,
        "text-chart-1-ink -mt-1 mb-2 inline-flex min-h-8 items-center gap-1 text-sm font-semibold no-underline md:mb-3",
      )}
    >
      <ChevronLeft aria-hidden className="size-4" />
      <span>
        <span className="hidden md:inline">Voltar para </span>
        {label}
      </span>
    </Link>
  );
}

export function ActiveFilters({
  parsed,
  options,
  payers,
  className,
}: {
  parsed: ParsedFilters;
  options: { accounts: Option[]; categories: Option[] };
  payers: readonly PayerOption[];
  className?: string;
}) {
  const f = parsed.filters;
  const href = (extra: Record<string, string | null>) =>
    `/lancamentos?${filtersToQuery(parsed, { cursor: null, ...extra })}`;
  const today = todayCivil();
  const month = monthOf(today);
  const defaultPeriod = f.from === firstDayOf(month) && f.to === dayOfMonth(month, 31);

  const chips: { key: string; label: string; short: string; remove: string }[] = [];
  // M09.1: a fila dos recebidos do banco (tirar o filtro volta à lista conferida, do mês)
  if (f.received) {
    chips.push({
      key: "situacao",
      label: "Recebidos do banco, esperando revisão",
      short: "Recebidos",
      remove: href({ situacao: null, de: null, ate: null }),
    });
  }
  if (f.categoryId) {
    const name =
      f.categoryId === "none"
        ? "Sem categoria"
        : (options.categories.find((c) => c.id === f.categoryId)?.name ?? "Categoria");
    chips.push({
      key: "categoria",
      label: `Categoria: ${name}`,
      short: name,
      remove: href({ categoria: null }),
    });
  }
  // O período sempre tem valor; vira filtro "ativo" quando não é o mês de hoje ou quando se veio
  // do painel (o número clicado é daquele período)
  if ((!defaultPeriod || parsed.back) && !f.received) {
    const label = periodLabel(f.from, f.to);
    chips.push({
      key: "periodo",
      label,
      short: label.split(" de ")[0] ?? label,
      remove: href({ de: null, ate: null }),
    });
  }
  // M10.1: o número de uma camada em Ajustes › Categorização
  if (f.categorizedBy) {
    const name = SOURCE_LABEL[f.categorizedBy];
    chips.push({
      key: "quem",
      label:
        f.categorizedBy === "MANUAL" ? "Categoria escolhida por você" : `Categorizado por: ${name}`,
      short: name,
      remove: href({ quem: null }),
    });
  }
  if (f.payer) {
    const param = payerParam(f.payer);
    const name = payers.find((p) => p.param === param)?.name ?? "Pessoa";
    chips.push({
      key: "pago",
      label: `Pago por: ${name}`,
      short: name,
      remove: href({ pago: null }),
    });
  }
  if (f.accountId) {
    const name = options.accounts.find((a) => a.id === f.accountId)?.name ?? "Conta";
    chips.push({
      key: "conta",
      label: `Conta: ${name}`,
      short: name,
      remove: href({ conta: null }),
    });
  }
  if (f.type) {
    chips.push({
      key: "tipo",
      label: TYPE_LABEL[f.type],
      short: TYPE_LABEL[f.type],
      remove: href({ tipo: null }),
    });
  }
  if (f.text) {
    chips.push({ key: "q", label: `Busca: ${f.text}`, short: f.text, remove: href({ q: null }) });
  }
  if (chips.length === 0) return null;

  return (
    <div
      role="group"
      aria-label="Filtros ativos"
      className={cn("flex flex-wrap items-center gap-2", className)}
    >
      <span className="text-muted-foreground mr-1 hidden text-sm font-semibold md:inline">
        Filtros
      </span>
      {chips.map((chip) => (
        <span
          key={chip.key}
          data-filter={chip.key}
          className="bg-chart-1/14 text-chart-1-ink flex h-9 items-center gap-0.5 rounded-full pr-1 pl-3 text-sm font-semibold md:gap-1 md:pr-1.5 md:pl-3.5"
        >
          <span className="md:hidden">{chip.short}</span>
          <span className="hidden md:inline">{chip.label}</span>
          <Link
            href={chip.remove}
            aria-label={`Tirar o filtro ${chip.label}`}
            className="focus-visible:ring-ring grid size-8 place-items-center rounded-full outline-none hover:bg-black/5 focus-visible:ring-3 md:size-7 dark:hover:bg-white/10"
          >
            <X aria-hidden className="size-[0.9375rem]" />
          </Link>
        </span>
      ))}
      <Link
        href={`/lancamentos?${filtersToQuery({ walletId: parsed.walletId, filters: { ...f, from: firstDayOf(month), to: dayOfMonth(month, 31), accountId: null, categoryId: null, text: null, type: null, payer: null, received: false } })}`}
        className={cn(NUMBER_LINK, "ml-1 text-sm font-semibold")}
      >
        Limpar
      </Link>
    </div>
  );
}
