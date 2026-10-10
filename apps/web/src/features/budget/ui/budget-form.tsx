"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { sumCents } from "@fintrack/core";
import { ActionForm } from "@/components/feedback/action-form";
import { MoneyInput } from "@/components/money/money-input";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { NativeSelect } from "@/components/ui/native-select";
import { useOptionalRouteModal } from "@/components/ui/route-modal";
import type { PayerOption } from "@/features/transactions/payers";
import { PayerTile } from "@/features/transactions/ui/payer-tile";
import type { ActionState } from "@/lib/action-state";
import { formatBRL } from "@/lib/money";
import { saveBudgetAction } from "../server/actions";

// "Editar valores" (M08, prancha D-Editar do canvas): o orçado de UMA categoria num ambiente e
// mês. Trocar a categoria preenche o valor que ela já tem (sem ir ao servidor). Num ambiente
// compartilhado, "Dividir por pessoa" mostra uma parte por pessoa e uma do Compartilhado; o orçado
// da categoria passa a ser a soma das partes (o servidor recalcula, não confia no total da tela).
// Valor zero sem divisão tira o orçado da categoria.

type Budget = { categoryId: string; cents: bigint; shares: { payer: string; cents: bigint }[] };

export function BudgetForm({
  idPrefix,
  walletId,
  month,
  shared,
  categories,
  categoryId: initialCategory,
  budgets,
  payers,
  split: initialSplit,
  backHref,
}: {
  idPrefix: string;
  walletId: string;
  month: string;
  shared: boolean;
  categories: readonly { id: string; name: string }[];
  categoryId: string | null;
  budgets: readonly Budget[];
  payers: readonly PayerOption[];
  split: boolean;
  backHref: string;
}) {
  const modal = useOptionalRouteModal();
  const router = useRouter();
  const [categoryId, setCategoryId] = useState(initialCategory ?? categories[0]?.id ?? "");
  const current = budgets.find((b) => b.categoryId === categoryId) ?? null;
  const [split, setSplit] = useState(shared && (initialSplit || (current?.shares.length ?? 0) > 0));
  const [amount, setAmount] = useState<bigint>(current?.cents ?? 0n);
  const [parts, setParts] = useState<Record<string, bigint>>(() => partsOf(current, payers));
  const total = useMemo(() => sumCents(Object.values(parts)), [parts]);

  // Trocar a categoria: o formulário passa a mostrar o orçado dela (ou vazio)
  const choose = (id: string) => {
    const next = budgets.find((b) => b.categoryId === id) ?? null;
    setCategoryId(id);
    setAmount(next?.cents ?? 0n);
    setParts(partsOf(next, payers));
    setSplit(shared && (next?.shares.length ?? 0) > 0);
  };

  return (
    <ActionForm<ActionState>
      action={saveBudgetAction}
      idPrefix={idPrefix}
      className="flex flex-col gap-4"
      aria-label="Orçado da categoria"
    >
      {({ pending, state }) => (
        <>
          <Done state={state} onDone={() => (modal ? modal.close() : router.push(backHref))} />
          <input type="hidden" name="walletId" value={walletId} />
          <input type="hidden" name="month" value={month} />

          <Field>
            <FieldLabel htmlFor={`${idPrefix}categoria`}>Categoria</FieldLabel>
            <NativeSelect
              id={`${idPrefix}categoria`}
              name="categoryId"
              value={categoryId}
              onChange={(e) => choose(e.target.value)}
              className="h-11 md:h-10"
            >
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {budgets.some((b) => b.categoryId === c.id) ? " (já orçada)" : ""}
                </option>
              ))}
            </NativeSelect>
            <FieldDescription>
              Orce a categoria de cima (Alimentação) ou as de baixo (Mercado, Padaria), não as duas
              no mesmo mês.
            </FieldDescription>
          </Field>

          {split ? (
            <fieldset className="flex flex-col gap-2.5" key={`partes-${categoryId}`}>
              <legend className="mb-1 text-sm font-semibold">Parte de cada um</legend>
              {payers.map((p) => (
                <div
                  key={p.param}
                  className="grid grid-cols-[2rem_minmax(0,1fr)_minmax(0,9.5rem)] items-center gap-3"
                >
                  <PayerTile payer={p} className="size-8 rounded-[0.625rem] text-xs" />
                  <label htmlFor={`${idPrefix}parte-${p.param}`} className="text-sm font-semibold">
                    {p.name}
                  </label>
                  <MoneyInput
                    id={`${idPrefix}parte-${p.param}`}
                    name={`parte:${p.param}`}
                    value={parts[p.param] ?? 0n}
                    onValueChange={(cents) => setParts((all) => ({ ...all, [p.param]: cents }))}
                    className="h-11 text-right md:h-10"
                  />
                </div>
              ))}
              <p
                className="bg-muted/60 flex items-center justify-between rounded-xl px-3.5 py-2.5 text-sm"
                aria-live="polite"
              >
                <span>Orçado de {nameOf(categories, categoryId)}: a soma das partes</span>
                <strong className="tabular font-mono" data-testid="soma-partes">
                  {formatBRL(total)}
                </strong>
              </p>
            </fieldset>
          ) : (
            <Field key={`valor-${categoryId}`}>
              <FieldLabel htmlFor={`${idPrefix}valor`}>Orçado no mês</FieldLabel>
              <MoneyInput
                id={`${idPrefix}valor`}
                name="amount"
                value={amount}
                onValueChange={setAmount}
                className="h-11 md:h-10"
              />
              <FieldDescription>
                {current
                  ? "Zero tira o orçado desta categoria."
                  : "Quanto o ambiente planeja gastar nela no mês."}
              </FieldDescription>
            </Field>
          )}

          {shared ? (
            <label className="flex items-start gap-2.5 text-sm">
              <input
                type="checkbox"
                name="split"
                checked={split}
                onChange={(e) => {
                  setSplit(e.target.checked);
                  // Ao dividir, a primeira parte começa com o valor que estava digitado
                  if (e.target.checked && total === 0n && amount > 0n && payers[0]) {
                    setParts((all) => ({ ...all, [payers[0]?.param ?? ""]: amount }));
                  }
                  if (!e.target.checked && total > 0n) setAmount(total);
                }}
                className="accent-primary focus-visible:ring-ring mt-0.5 size-4 rounded outline-none focus-visible:ring-3"
              />
              <span className="flex flex-col">
                <span className="font-semibold">Dividir por pessoa</span>
                <span className="text-muted-foreground">
                  Quanto cada um planeja pagar. Compras com cartão de compras conjuntas contam como
                  Compartilhado.
                </span>
              </span>
            </label>
          ) : null}

          <div className="flex flex-col-reverse gap-2.5 pt-1 md:flex-row md:justify-end">
            <Button
              type="button"
              variant="outline"
              className="h-11 md:h-10"
              onClick={() => (modal ? modal.close() : router.push(backHref))}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={pending || !categoryId} className="h-11 md:h-10">
              {pending ? "Salvando…" : "Salvar"}
            </Button>
          </div>
        </>
      )}
    </ActionForm>
  );
}

function partsOf(budget: Budget | null, payers: readonly PayerOption[]): Record<string, bigint> {
  const parts: Record<string, bigint> = {};
  for (const p of payers)
    parts[p.param] = budget?.shares.find((s) => s.payer === p.param)?.cents ?? 0n;
  return parts;
}

const nameOf = (categories: readonly { id: string; name: string }[], id: string) =>
  categories.find((c) => c.id === id)?.name ?? "a categoria";

/** Salvou: avisa e volta ao orçamento (o aviso verde do formulário some junto com ele). */
function Done({ state, onDone }: { state: ActionState; onDone: () => void }) {
  const seen = useRef(state);
  useEffect(() => {
    if (state === seen.current) return;
    seen.current = state;
    if (state.success && !state.error) {
      toast.success(state.success);
      onDone();
    }
  }, [state, onDone]);
  return null;
}
