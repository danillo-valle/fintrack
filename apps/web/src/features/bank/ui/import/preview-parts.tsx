// As peças da conferência (M09.3, pranchas E3-Conferir, E3-Cartao e E3-CelConferir): o resumo
// do arquivo, os três números (novos, Meu Pluggy, já importados) e as linhas com o estado de
// cada uma. O estado está sempre escrito; a cor e o ícone só reforçam.
import { CircleCheck, CreditCard, Landmark, Link2, Plus } from "lucide-react";
import type { ImportRowState } from "@fintrack/core";
import type { PreviewRow } from "../../server/imports";
import { AmountText } from "@/components/money/amount-text";
import { ToneChip } from "@/components/visual/tone-chip";
import { formatBRL } from "@/lib/money";
import { dayMonth } from "../review/parts";

/** Quantas linhas a conferência mostra (o resto aparece em Recebidos depois). */
export const PREVIEW_ROWS = 10;

const year = (date: string) => date.slice(0, 4);

export function PreviewSummary({
  kind,
  institution,
  lastFour,
  period,
  fileName,
  rowCount,
  balance,
}: {
  kind: "BANK" | "CREDIT_CARD";
  institution: string | null;
  lastFour: string | null;
  period: { from: string; to: string } | null;
  fileName: string;
  rowCount: number;
  balance: { amount: bigint } | null;
}) {
  const Icon = kind === "CREDIT_CARD" ? CreditCard : Landmark;
  const what = kind === "CREDIT_CARD" ? "cartão" : "conta";
  const title = [
    institution ?? (kind === "CREDIT_CARD" ? "Fatura do cartão" : "Extrato da conta"),
    lastFour ? `${what} final ${lastFour}` : null,
    period ? `${dayMonth(period.from)} a ${dayMonth(period.to)}/${year(period.to)}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const balanceText = balance
    ? kind === "CREDIT_CARD"
      ? ` · saldo do cartão ${formatBRL(balance.amount < 0n ? -balance.amount : balance.amount)}`
      : ` · saldo no fim do período ${formatBRL(balance.amount)}`
    : "";
  return (
    <div className="grid grid-cols-[2.5rem_minmax(0,1fr)] items-center gap-3">
      <span
        aria-hidden
        className="text-chart-5-ink grid size-10 place-items-center rounded-xl bg-[color-mix(in_srgb,var(--chart-5)_14%,transparent)]"
      >
        <Icon className="size-5" />
      </span>
      <span className="flex min-w-0 flex-col gap-0.5">
        <strong className="text-base" data-testid="resumo-arquivo">
          {title}
        </strong>
        <span className="text-muted-foreground text-[0.8125rem] break-words">
          {fileName} · {rowCount === 1 ? "1 lançamento" : `${rowCount} lançamentos`}
          {balanceText}
        </span>
      </span>
    </div>
  );
}

const TILE: Record<
  ImportRowState,
  { tone: 1 | 4 | 5; one: string; many: string; note: string; testId: string }
> = {
  NEW: {
    tone: 5,
    one: "novo",
    many: "novos",
    note: "entram como Recebidos",
    testId: "contagem-novos",
  },
  PLUGGY: {
    tone: 4,
    one: "já veio pelo Meu Pluggy",
    many: "já vieram pelo Meu Pluggy",
    note: "mesmo valor e data: não entram",
    testId: "contagem-pluggy",
  },
  IMPORTED: {
    tone: 1,
    one: "já importado",
    many: "já importados",
    note: "mesmo id do banco: não entram",
    testId: "contagem-importados",
  },
};

export function ImportTiles({ counts }: { counts: Record<ImportRowState, number> }) {
  return (
    <ul aria-label="O que acontece com as linhas" className="grid gap-2.5 md:grid-cols-3">
      {(["NEW", "PLUGGY", "IMPORTED"] as const).map((state) => {
        const tile = TILE[state];
        const n = counts[state];
        return (
          <li
            key={state}
            data-testid={tile.testId}
            style={
              {
                "--tone": `var(--chart-${tile.tone})`,
                "--ink": `var(--chart-${tile.tone}-ink)`,
              } as React.CSSProperties
            }
            className="flex flex-col gap-0.5 rounded-2xl bg-[color-mix(in_srgb,var(--tone)_14%,transparent)] px-3.5 py-3"
          >
            <span className="tabular text-[1.375rem] font-extrabold text-[var(--ink)] md:text-[1.625rem]">
              {n}
            </span>
            <strong className="text-sm">{n === 1 ? tile.one : tile.many}</strong>
            <span className="text-muted-foreground text-xs">{tile.note}</span>
          </li>
        );
      })}
    </ul>
  );
}

const CHIP: Record<ImportRowState, { tone: 1 | 4 | 5; icon: typeof Plus; label: string }> = {
  NEW: { tone: 5, icon: Plus, label: "Novo" },
  PLUGGY: { tone: 4, icon: Link2, label: "Já veio pelo Meu Pluggy" },
  IMPORTED: { tone: 1, icon: CircleCheck, label: "Já importado" },
};

export function PreviewRows({
  rows,
  states,
}: {
  rows: readonly PreviewRow[];
  states: readonly ImportRowState[];
}) {
  const shown = rows
    .map((row, i) => ({ row, state: states[i] ?? "NEW" }))
    .sort((a, b) => b.row.occurredOn.localeCompare(a.row.occurredOn))
    .slice(0, PREVIEW_ROWS);
  return (
    <ul aria-label="Lançamentos do arquivo" className="divide-y max-md:border-t">
      {shown.map(({ row, state }) => {
        const chip = CHIP[state];
        return (
          <li
            key={row.externalId}
            data-testid="linha-arquivo"
            className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-2.5 gap-y-1 py-2.5 md:grid-cols-[3.5rem_minmax(0,1fr)_13.125rem_9.375rem] md:items-center md:gap-x-3 max-md:[&:nth-child(5)]:border-b-0 max-md:[&:nth-child(n+6)]:hidden"
          >
            <span className="text-muted-foreground tabular hidden font-mono text-[0.8125rem] md:block">
              {dayMonth(row.occurredOn)}
            </span>
            <span className="truncate text-[0.9375rem] font-semibold">{row.description}</span>
            <span className="col-span-2 row-start-2 flex items-center gap-1.5 md:col-span-1 md:col-start-3 md:row-start-1">
              <span className="text-muted-foreground tabular font-mono text-xs md:hidden">
                {dayMonth(row.occurredOn)}
              </span>
              <ToneChip tone={chip.tone} icon={chip.icon}>
                {chip.label}
              </ToneChip>
            </span>
            <AmountText
              cents={row.amount}
              tone="inherit"
              arrow={false}
              className="col-start-2 row-start-1 justify-self-end font-bold md:col-start-4"
            />
          </li>
        );
      })}
    </ul>
  );
}
