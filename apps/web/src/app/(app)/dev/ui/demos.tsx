"use client";

import { useRef, useState } from "react";
import { flushSync } from "react-dom";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { ErrorState } from "@/components/feedback/error-state";
import { undoToastOptions } from "@/components/feedback/undo-toast";
import { AmountText } from "@/components/money/amount-text";
import { MoneyInput } from "@/components/money/money-input";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { centsToDecimal } from "@/lib/money";

export function MoneyInputDemo() {
  const [cents, setCents] = useState<bigint>(0n);
  return (
    <Field className="max-w-xs">
      <FieldLabel htmlFor="demo-valor">Valor de exemplo</FieldLabel>
      <MoneyInput id="demo-valor" value={cents} onValueChange={setCents} />
      <FieldDescription>
        Enviado ao servidor como <code>{centsToDecimal(cents)}</code>
      </FieldDescription>
    </Field>
  );
}

export function ErrorDemo() {
  return <ErrorState onRetry={() => toast("Tentando de novo…")} />;
}

type Item = { id: number; description: string; cents: bigint };

const SAMPLE: Item[] = [
  { id: 1, description: "Mercado (exemplo)", cents: -42350n },
  { id: 2, description: "Salário (exemplo)", cents: 850000n },
  { id: 3, description: "Farmácia (exemplo)", cents: -6790n },
];

// Excluir sem confirmação, mas com "Desfazer": mais rápido que perguntar "tem certeza?" e igualmente seguro
export function UndoDeleteDemo({ headingId }: { headingId: string }) {
  const [items, setItems] = useState<Item[]>(SAMPLE);
  const deleteButtons = useRef(new Map<number, HTMLButtonElement>());

  // O botão focado some junto com o item; sem isto o foco cairia no body
  function remove(item: Item) {
    const index = items.findIndex((i) => i.id === item.id);
    const remaining = items.filter((i) => i.id !== item.id);
    const next = remaining[index] ?? remaining[index - 1];

    flushSync(() => setItems(remaining));
    if (next) deleteButtons.current.get(next.id)?.focus();
    else document.getElementById(headingId)?.focus();

    toast(
      `"${item.description}" excluído`,
      undoToastOptions({
        onUndo: () => {
          flushSync(() => setItems((current) => [...current, item].sort((a, b) => a.id - b.id)));
          deleteButtons.current.get(item.id)?.focus();
        },
      }),
    );
  }

  return (
    <ul className="divide-y rounded-xl border">
      {items.map((item) => (
        <li key={item.id} className="flex items-center justify-between gap-3 px-4 py-3">
          <span className="min-w-0 truncate">{item.description}</span>
          <span className="flex items-center gap-2">
            <AmountText cents={item.cents} />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => remove(item)}
              ref={(el) => {
                if (el) deleteButtons.current.set(item.id, el);
                return () => {
                  deleteButtons.current.delete(item.id);
                };
              }}
              aria-label={`Excluir ${item.description}`}
            >
              <Trash2 aria-hidden />
            </Button>
          </span>
        </li>
      ))}
      {items.length === 0 ? (
        <li className="text-muted-foreground px-4 py-3 text-sm">
          Lista vazia. Use &quot;Desfazer&quot; no aviso.
        </li>
      ) : null}
    </ul>
  );
}
