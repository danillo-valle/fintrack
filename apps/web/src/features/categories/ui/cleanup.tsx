"use client";

// A limpeza das categorias que eram transferência (M13.3b, ADR-026, prancha N-Limpeza), no topo de
// Ajustes › Categorias:
//   aviso        "2 categorias parecem transferência" e o Revisar (abre a revisão: ?revisar=)
//   revisão      por categoria: os pares (de onde saiu → para onde foi), os que ficam de um lado
//                só, "Arquivar a categoria depois" e "Tratar os N como transferência"
//   Desfazer     por 30 minutos depois de tratar, no topo: tudo volta como estava
// A revisão é um formulário com a Server Action direta (funciona antes do JavaScript); o servidor
// refaz a conta e recusa se os N mudaram desde que a pessoa olhou.
import Link from "next/link";
import { ArrowRight, ArrowLeftRight, TriangleAlert, Undo2 } from "lucide-react";
import type { CleanupCandidate as CategoryCleanupView } from "../server/queries";
import { ActionButton } from "@/components/feedback/action-button";
import { ActionForm } from "@/components/feedback/action-form";
import { AmountText } from "@/components/money/amount-text";
import { Button } from "@/components/ui/button";
import { civilDayMonth } from "@/lib/dates";
import { formatBRL } from "@/lib/money";
import { applyCleanupAction, undoCleanupAction } from "../server/actions";
import { NATIVE_CHECK } from "@/lib/styles";
import { cn } from "@/lib/utils";

const names = new Intl.ListFormat("pt-BR", { type: "conjunction" });
const plural = (n: number, one: string, many: string) => (n === 1 ? `1 ${one}` : `${n} ${many}`);

export function CleanupBanner({
  candidates,
  reviewHref,
}: {
  candidates: readonly CategoryCleanupView[];
  reviewHref: string;
}) {
  if (candidates.length === 0) return null;
  const total = candidates.reduce((n, c) => n + c.count, 0);
  return (
    <section
      aria-labelledby="limpeza-aviso"
      className="flex items-start gap-3 rounded-2xl border bg-[color-mix(in_srgb,var(--chart-4)_14%,transparent)] p-4"
      data-testid="limpeza-aviso"
    >
      <TriangleAlert aria-hidden className="text-chart-4-ink mt-0.5 size-5 shrink-0" />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <h2 id="limpeza-aviso" className="text-[0.9375rem] font-bold">
          {candidates.length === 1
            ? "1 categoria parece transferência"
            : `${candidates.length} categorias parecem transferência`}
        </h2>
        <p className="text-muted-foreground text-sm">
          {names.format(candidates.map((c) => `“${c.category.name}”`))}{" "}
          {candidates.length === 1 ? "tem" : "têm"} {plural(total, "lançamento", "lançamentos")} que{" "}
          {total === 1 ? "conta" : "contam"} como gasto ou receita, e entram na previsão.
        </p>
      </div>
      <Button asChild variant="outline">
        <Link href={reviewHref}>Revisar</Link>
      </Button>
    </section>
  );
}

function Side({ line }: { line: CategoryCleanupView["oneSided"][number] }) {
  return (
    <span className="flex min-w-0 flex-col">
      <span className="truncate font-semibold">{line.accountName}</span>
      <span className="text-muted-foreground truncate text-xs">{line.name}</span>
    </span>
  );
}

export function CleanupReview({
  candidate,
  backHref,
}: {
  candidate: CategoryCleanupView;
  backHref: string;
}) {
  const { category, count, paired, pairs, oneSided } = candidate;
  const headingId = `limpeza-${category.id}`;
  return (
    <section
      aria-labelledby={headingId}
      className="bg-card flex flex-col gap-3 rounded-2xl border p-5 md:p-6"
      data-testid="limpeza-revisao"
    >
      <h2 id={headingId} className="text-lg font-bold">
        {category.name} é transferência?
      </h2>
      <p className="text-muted-foreground text-sm">
        {plural(count, "lançamento confirmado", "lançamentos confirmados")} com esta categoria. O
        FinTrack achou o outro lado de {paired} deles nas suas contas.
      </p>
      {pairs.length > 0 ? (
        <ul aria-label={`Os pares de ${category.name}`} className="divide-y border-y">
          {pairs.map((p) => (
            <li
              key={`${p.out.id}-${p.in.id}`}
              className="grid grid-cols-[3.25rem_minmax(0,1fr)_1.25rem_minmax(0,1fr)_auto] items-center gap-3 py-2.5 text-sm"
            >
              <span className="text-muted-foreground tabular font-mono">
                {civilDayMonth(p.out.occurredOn)}
              </span>
              <Side line={p.out} />
              <ArrowRight aria-label="para" className="text-chart-1-ink size-4" />
              <Side line={p.in} />
              <AmountText
                cents={p.in.amount}
                tone="inherit"
                arrow={false}
                className="justify-self-end font-bold"
              />
            </li>
          ))}
        </ul>
      ) : null}
      {oneSided.length > 0 ? (
        <p className="text-muted-foreground text-sm">
          {oneSided.length === 1 ? "1 sem o outro lado" : `${oneSided.length} sem o outro lado`} (
          {oneSided
            .map(
              (l) =>
                `${civilDayMonth(l.occurredOn)}, ${formatBRL(l.amount < 0n ? -l.amount : l.amount)}`,
            )
            .join("; ")}
          ) {oneSided.length === 1 ? "vira" : "viram"} “transferência para uma conta minha fora do
          FinTrack”.
        </p>
      ) : null}
      <ActionForm action={applyCleanupAction} aria-label={`Limpar ${category.name}`}>
        {({ pending }) => (
          <div className="flex flex-col gap-3">
            <input type="hidden" name="categoryId" value={category.id} />
            <input type="hidden" name="expectedCount" value={count} />
            <label className="flex min-h-11 cursor-pointer items-center gap-2.5 text-[0.9375rem]">
              <input
                type="checkbox"
                name="archive"
                defaultChecked
                className={cn(NATIVE_CHECK, "size-5")}
              />
              Arquivar a categoria depois
            </label>
            <div className="flex flex-wrap justify-end gap-2">
              <Button asChild variant="ghost">
                <Link href={backHref}>Agora não</Link>
              </Button>
              <Button type="submit" disabled={pending}>
                <ArrowLeftRight aria-hidden />
                Tratar os {count} como transferência
              </Button>
            </div>
          </div>
        )}
      </ActionForm>
      <p className="text-muted-foreground text-[0.8125rem]">
        Por 30 minutos aparece Desfazer: tudo volta como estava, com a categoria.
      </p>
    </section>
  );
}

export function UndoCleanups({
  cleanups,
}: {
  cleanups: readonly { id: string; categoryName: string; count: number; archived: boolean }[];
}) {
  if (cleanups.length === 0) return null;
  return (
    <ul aria-label="Limpezas que dá para desfazer" className="flex flex-col gap-2">
      {cleanups.map((c) => (
        <li
          key={c.id}
          role="status"
          data-testid="limpeza-feita"
          className="bg-income/12 flex flex-wrap items-center gap-3 rounded-2xl p-3.5 text-[0.9375rem]"
        >
          <ArrowLeftRight aria-hidden className="text-income size-5 shrink-0" />
          <span className="min-w-0 flex-1">
            <strong>“{c.categoryName}”</strong>:{" "}
            {plural(c.count, "lançamento virou", "lançamentos viraram")} transferência
            {c.archived ? ", e a categoria foi arquivada" : ""}.
          </span>
          <ActionButton
            action={undoCleanupAction}
            fields={{ cleanupId: c.id }}
            label={`Desfazer a limpeza de ${c.categoryName}`}
          >
            <Undo2 aria-hidden />
            Desfazer
          </ActionButton>
        </li>
      ))}
    </ul>
  );
}
