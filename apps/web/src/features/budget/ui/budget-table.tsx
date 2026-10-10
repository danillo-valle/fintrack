"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronDown, ChevronUp, TriangleAlert } from "lucide-react";
import type { BudgetStatus } from "@fintrack/core";
import { MoneyLink } from "@/components/money/money-link";
import { ChartLegend } from "@/components/visual/chart-legend";
import { PayerTile } from "@/features/transactions/ui/payer-tile";
import { percentOf } from "@/lib/chart";
import { formatBRL } from "@/lib/money";
import { NUMBER_LINK } from "@/lib/styles";
import { cn } from "@/lib/utils";
import type { BudgetPartView, BudgetRowView } from "../server/queries";

// O orçamento por categoria (M08, canvas D "Orçamento da Casa, Mercado dividido por pessoa").
//
// Uma linha por categoria orçada: gasto até hoje, a barra de andamento (cheio = gasto, listrado =
// previsto, traço = orçado), o previsto, o orçado, o mês passado e a média de 6 meses, e a
// situação escrita ("Acima: + R$ 261,43", com ícone). No celular, cada linha é um cartão; a
// partir de lg as MESMAS linhas viram colunas alinhadas com o cabeçalho (sem repetir texto, como
// a lista de lançamentos). A divisão por pessoa aparece embaixo da categoria e pode ser recolhida.

/** As colunas do computador (cabeçalho, linhas, partes e total usam a mesma). */
const COLUMNS =
  "lg:grid-cols-[minmax(0,1.2fr)_5.75rem_minmax(0,1fr)_6.25rem_6.25rem_6.5rem_8.75rem]";

export function statusText(status: BudgetStatus, onlyFixed: boolean, nextDue: string | null) {
  if (status.kind === "none") return "Sem divisão";
  if (status.kind === "over") return `Acima: + ${formatBRL(status.by)}`;
  if (onlyFixed && nextDue) return `Fixa, vence dia ${Number(nextDue.slice(8, 10))}`;
  return `Sobra ${formatBRL(status.left)}`;
}

function Status({ status, text }: { status: BudgetStatus; text: string }) {
  const over = status.kind === "over";
  return (
    <span
      className={cn(
        "flex items-center gap-1.5 text-[0.8125rem] font-semibold",
        over ? "text-expense" : "text-muted-foreground",
      )}
    >
      {over ? <TriangleAlert aria-hidden className="size-4 shrink-0" /> : null}
      {text}
    </span>
  );
}

/** A barra de andamento: gasto (cheio), previsto (listrado) e o traço do orçado. */
function BudgetBar({
  spent,
  projected,
  budget,
  label,
  size = "md",
}: {
  spent: bigint;
  projected: bigint;
  budget: bigint | null;
  label: string;
  size?: "md" | "sm";
}) {
  const top = budget !== null && budget > projected ? budget : projected;
  const scale = (top * 100n) / 82n; // o maior dos dois ocupa 82 % (sobra espaço para o traço)
  const real = percentOf(spent, scale);
  return (
    <span
      role="img"
      aria-label={label}
      className={cn(
        "bg-muted relative block w-full",
        size === "md" ? "h-3.5 rounded-[5px] lg:h-4" : "h-2 rounded",
      )}
    >
      <span
        className="bg-chart-1 absolute inset-y-0 left-0 rounded-l-[inherit]"
        style={{ width: real }}
      />
      <span
        className="hatch absolute inset-y-0"
        style={{ left: real, width: percentOf(projected - spent, scale) }}
      />
      {budget !== null ? (
        <span
          className="bg-foreground absolute -inset-y-1 -ml-px w-0.5"
          style={{ left: percentOf(budget, scale) }}
        />
      ) : null}
    </span>
  );
}

function barLabel(
  name: string,
  spent: bigint,
  projected: bigint,
  budget: bigint | null,
  status: string,
) {
  return `${name}: gasto ${formatBRL(spent)}, previsto ${formatBRL(projected)}${
    budget !== null ? `, orçado ${formatBRL(budget)}` : ""
  }. ${status}.`;
}

export function BudgetTable({
  rows,
  totals,
  showWallet,
  payerFiltered,
  canEditSomething,
}: {
  rows: readonly BudgetRowView[];
  totals: { spent: bigint; projected: bigint; budget: bigint; lastMonth: bigint; average: bigint };
  /** "Tudo que vejo": cada linha diz de que ambiente é */
  showWallet: boolean;
  payerFiltered: boolean;
  canEditSomething: boolean;
}) {
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const toggle = (key: string) =>
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const left = totals.budget - totals.projected;

  return (
    <section
      aria-labelledby="por-categoria"
      className="lg:bg-card flex flex-col gap-3 lg:gap-0 lg:overflow-hidden lg:rounded-[1.25rem] lg:border"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 lg:px-5 lg:pt-[1.125rem] lg:pb-3">
        <h2 id="por-categoria" className="text-lg font-extrabold tracking-[-0.01em] lg:text-xl">
          Por categoria
        </h2>
        <ChartLegend
          items={[
            { label: "Gasto até hoje", mark: "bar" },
            { label: "Previsto até o fim do mês", mark: "hatch" },
            { label: "Orçado", mark: "tick" },
          ]}
        />
      </div>

      {/* O cabeçalho das colunas é só visual: cada valor já diz o que é para o leitor de tela */}
      <div
        aria-hidden
        className={cn(
          "bg-muted/60 text-muted-foreground hidden gap-3 border-t px-5 py-2 text-xs font-bold tracking-[0.03em] uppercase lg:grid",
          COLUMNS,
        )}
      >
        <span className="pl-9">Categoria</span>
        <span className="text-right">Gasto</span>
        <span>Andamento</span>
        <span className="text-right">Previsto</span>
        <span className="text-right">Orçado</span>
        <span className="text-right">Mês passado · média 6 m</span>
        <span>Situação</span>
      </div>

      <ul className="flex flex-col gap-2.5 lg:gap-0 lg:text-sm" data-testid="orcamento-linhas">
        {rows.map((r) => {
          const status = statusText(r.status, r.onlyFixed, r.nextDue);
          const hasParts = r.parts.length > 0;
          const open = hasParts && !collapsed.has(r.key);
          const partsId = `partes-${r.key.replace(":", "-")}`;
          return (
            <li
              key={r.key}
              data-category={r.categoryId}
              className="bg-card flex flex-col gap-2 rounded-[1.125rem] border p-3.5 lg:gap-0 lg:rounded-none lg:border-x-0 lg:border-b-0 lg:p-0"
            >
              <div
                className={cn(
                  "grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 lg:gap-3 lg:px-5 lg:py-3",
                  COLUMNS,
                )}
              >
                {/* Categoria */}
                <span className="col-start-1 row-start-1 flex min-w-0 items-center gap-2">
                  {hasParts ? (
                    <button
                      type="button"
                      onClick={() => toggle(r.key)}
                      aria-expanded={open}
                      aria-controls={partsId}
                      aria-label={
                        open
                          ? `Recolher a divisão de ${r.categoryName} por pessoa`
                          : `Mostrar a divisão de ${r.categoryName} por pessoa`
                      }
                      className="focus-visible:ring-ring bg-card hidden size-7 shrink-0 cursor-pointer place-items-center rounded-lg border outline-none focus-visible:ring-3 lg:grid"
                    >
                      {open ? (
                        <ChevronUp aria-hidden className="size-[0.9375rem]" />
                      ) : (
                        <ChevronDown aria-hidden className="size-[0.9375rem]" />
                      )}
                    </button>
                  ) : (
                    <span aria-hidden className="hidden w-7 shrink-0 lg:block" />
                  )}
                  <span className="flex min-w-0 flex-col">
                    <Link
                      href={r.evolutionHref}
                      className={cn(
                        NUMBER_LINK,
                        "truncate text-base font-bold lg:text-[0.9375rem]",
                      )}
                    >
                      {r.categoryName}
                    </Link>
                    {showWallet ? (
                      <span className="text-muted-foreground truncate text-xs">{r.walletName}</span>
                    ) : null}
                  </span>
                  {r.onlyFixed ? (
                    <span className="border-chart-5 text-chart-5-ink shrink-0 rounded-full border px-2 py-px text-xs font-semibold">
                      Fixa
                    </span>
                  ) : null}
                </span>

                {/* Gasto */}
                <span className="col-start-2 row-start-1 text-right lg:col-start-2">
                  <MoneyLink
                    cents={r.spent.cents}
                    href={r.spent.href}
                    label={`${r.categoryName}, gasto até hoje`}
                    className="font-bold"
                    data-testid="linha-gasto"
                  />
                </span>

                {/* Andamento */}
                <span className="col-span-2 row-start-2 lg:col-span-1 lg:col-start-3 lg:row-start-1">
                  <BudgetBar
                    spent={r.spent.cents}
                    projected={r.projected.cents}
                    budget={r.budget}
                    label={barLabel(
                      r.categoryName,
                      r.spent.cents,
                      r.projected.cents,
                      r.budget,
                      status,
                    )}
                  />
                </span>

                {/* Previsto e orçado (no celular, uma frase: "prev. X de Y") */}
                <span className="text-muted-foreground col-start-1 row-start-3 text-[0.8125rem] lg:contents">
                  <span className="lg:hidden">prev. </span>
                  <span className="lg:text-foreground lg:col-start-4 lg:row-start-1 lg:text-right lg:text-sm">
                    <MoneyLink
                      cents={r.projected.cents}
                      href={r.projected.href}
                      label={`${r.categoryName}, previsto até o fim do mês`}
                    />
                  </span>
                  <span className="lg:hidden"> de </span>
                  <span className="lg:text-foreground lg:col-start-5 lg:row-start-1 lg:text-right lg:text-sm lg:font-semibold">
                    {r.budget === null ? (
                      <span title="Esta categoria não está dividida por pessoa">sem divisão</span>
                    ) : r.editHref ? (
                      <Link
                        href={r.editHref}
                        aria-label={`Orçado de ${r.categoryName}: ${formatBRL(r.budget)}. Editar`}
                        className={cn(NUMBER_LINK, "tabular font-mono")}
                      >
                        {formatBRL(r.budget)}
                      </Link>
                    ) : (
                      <span className="tabular font-mono">{formatBRL(r.budget)}</span>
                    )}
                  </span>
                </span>

                {/* Mês passado e média (só no computador) */}
                <span className="hidden flex-col items-end text-[0.8125rem] lg:col-start-6 lg:row-start-1 lg:flex">
                  <MoneyLink
                    cents={r.lastMonth.cents}
                    href={r.lastMonth.href}
                    label={`${r.categoryName}, mês passado`}
                    className="text-muted-foreground"
                  />
                  <MoneyLink
                    cents={r.average.cents}
                    href={r.average.href}
                    label={`${r.categoryName}, média de 6 meses`}
                    className="text-muted-foreground"
                  />
                </span>

                {/* Situação */}
                <span className="col-start-2 row-start-3 justify-self-end lg:col-start-7 lg:row-start-1 lg:justify-self-start">
                  <Status status={r.status} text={status} />
                </span>
              </div>

              {hasParts ? (
                <div
                  id={partsId}
                  hidden={!open}
                  className="flex flex-col gap-1.5 border-t border-dashed pt-2 lg:gap-0.5 lg:border-t-0 lg:px-5 lg:pt-0 lg:pb-3.5"
                >
                  {r.parts.map((p) => (
                    <PartRow key={p.payer.param} part={p} categoryName={r.categoryName} />
                  ))}
                  <p className="text-muted-foreground text-xs lg:pt-1.5 lg:pl-9 lg:text-[0.8125rem]">
                    O orçado de {r.categoryName} é a soma das partes.
                    {r.unassigned > 0n
                      ? ` ${formatBRL(r.unassigned)} ficaram sem dono (alguém saiu do lar): divida de novo.`
                      : " Compras com cartão de compras conjuntas contam como Compartilhado."}
                  </p>
                </div>
              ) : r.splittable && r.editHref && !payerFiltered ? (
                <Link
                  href={`${r.editHref}&dividir=1`}
                  className="text-muted-foreground focus-visible:ring-ring flex h-9 w-fit items-center gap-1.5 rounded-[0.625rem] border px-3 text-[0.8125rem] font-semibold outline-none focus-visible:ring-3 lg:hidden"
                >
                  <ChevronDown aria-hidden className="size-3.5" />
                  Dividir por pessoa
                </Link>
              ) : null}
            </li>
          );
        })}
      </ul>

      <div
        data-testid="orcamento-total"
        className={cn(
          "bg-card lg:bg-muted/60 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-[1.125rem] border p-3.5 font-extrabold lg:rounded-none lg:border-x-0 lg:border-t-2 lg:border-b-0 lg:px-5 lg:py-3.5 lg:text-sm",
          COLUMNS,
        )}
      >
        <span className="lg:pl-9">Total</span>
        <span className="tabular text-right font-mono" data-cents={totals.spent.toString()}>
          {formatBRL(totals.spent)}
        </span>
        <span className="hidden lg:block" />
        <span className="tabular hidden text-right font-mono lg:block">
          {formatBRL(totals.projected)}
        </span>
        <span className="tabular hidden text-right font-mono lg:block">
          {formatBRL(totals.budget)}
        </span>
        <span className="text-muted-foreground tabular hidden flex-col items-end font-mono text-[0.8125rem] font-semibold lg:flex">
          <span>{formatBRL(totals.lastMonth)}</span>
          <span>{formatBRL(totals.average)}</span>
        </span>
        <span className="text-muted-foreground col-span-2 text-[0.8125rem] font-semibold lg:col-span-1">
          {payerFiltered
            ? "Soma das linhas acima"
            : left >= 0n
              ? `Sobra ${formatBRL(left)}`
              : `Passa ${formatBRL(-left)}`}
        </span>
      </div>
      {canEditSomething ? null : (
        <p className="text-muted-foreground px-1 text-[0.8125rem] lg:px-5 lg:py-3">
          Você só vê este orçamento: quem edita é o dono ou o editor do ambiente.
        </p>
      )}
    </section>
  );
}

function PartRow({ part, categoryName }: { part: BudgetPartView; categoryName: string }) {
  const name = part.payer.name;
  const status = statusText(part.status, false, null);
  return (
    <div
      className={cn(
        "lg:bg-muted/50 grid grid-cols-[1.875rem_minmax(0,1fr)_auto] items-center gap-2.5 rounded-xl lg:gap-3 lg:py-2 lg:pl-9",
        "lg:grid-cols-[minmax(0,1.2fr)_5.75rem_minmax(0,1fr)_6.25rem_6.25rem_6.5rem_8.75rem]",
      )}
    >
      <span className="flex items-center gap-2.5 lg:col-start-1">
        <PayerTile
          payer={part.payer}
          className="size-[1.875rem] rounded-[0.5625rem] text-xs lg:size-8 lg:rounded-[0.625rem]"
        />
        <span className="hidden text-sm font-semibold lg:inline">{name}</span>
      </span>
      <span className="text-right text-sm font-bold lg:col-start-2 lg:row-start-1">
        <span className="lg:hidden">
          <BudgetBar
            spent={part.spent.cents}
            projected={part.projected.cents}
            budget={part.budget}
            size="sm"
            label={barLabel(
              `${categoryName}, pago por ${name}`,
              part.spent.cents,
              part.projected.cents,
              part.budget,
              status,
            )}
          />
        </span>
        <span className="hidden lg:inline">
          <MoneyLink
            cents={part.spent.cents}
            href={part.spent.href}
            label={`${categoryName}, pago por ${name}, gasto até hoje`}
          />
        </span>
      </span>
      <span className="flex flex-col items-end lg:hidden">
        <MoneyLink
          cents={part.spent.cents}
          href={part.spent.href}
          label={`${categoryName}, pago por ${name}, gasto até hoje`}
          className="text-sm font-bold"
        />
        <span
          className={cn(
            "tabular font-mono text-xs",
            part.status.kind === "over" ? "text-expense" : "text-muted-foreground",
          )}
        >
          de {formatBRL(part.budget)}
        </span>
      </span>
      <span className="hidden lg:col-start-3 lg:row-start-1 lg:block">
        <BudgetBar
          spent={part.spent.cents}
          projected={part.projected.cents}
          budget={part.budget}
          size="sm"
          label={barLabel(
            `${categoryName}, pago por ${name}`,
            part.spent.cents,
            part.projected.cents,
            part.budget,
            status,
          )}
        />
      </span>
      <span className="hidden text-right text-sm lg:col-start-4 lg:row-start-1 lg:block">
        <MoneyLink
          cents={part.projected.cents}
          href={part.projected.href}
          label={`${categoryName}, pago por ${name}, previsto`}
        />
      </span>
      <span className="tabular hidden text-right font-mono text-sm font-semibold lg:col-start-5 lg:row-start-1 lg:block">
        {formatBRL(part.budget)}
      </span>
      <span className="hidden flex-col items-end text-[0.8125rem] lg:col-start-6 lg:row-start-1 lg:flex">
        <MoneyLink
          cents={part.lastMonth.cents}
          href={part.lastMonth.href}
          label={`${categoryName}, pago por ${name}, mês passado`}
          className="text-muted-foreground"
        />
        <MoneyLink
          cents={part.average.cents}
          href={part.average.href}
          label={`${categoryName}, pago por ${name}, média de 6 meses`}
          className="text-muted-foreground"
        />
      </span>
      <span className="hidden lg:col-start-7 lg:row-start-1 lg:block">
        <Status status={part.status} text={status} />
      </span>
    </div>
  );
}
