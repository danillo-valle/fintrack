"use client";

import { useRef, useState } from "react";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { ErrorState } from "@/components/feedback/error-state";
import { undoToast } from "@/components/feedback/undo-toast";
import { AmountText } from "@/components/money/amount-text";
import { MoneyInput } from "@/components/money/money-input";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { focusAfterToast } from "@/lib/focus";
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

// Excluir sem confirmação, mas com "Desfazer": mais rápido que perguntar "tem certeza?" e igualmente seguro.
// Cuidado com o foco: o botão clicado some da tela. Sem tratamento, o foco cairia no início da
// página e quem usa teclado teria de recomeçar. Por isso o foco vai para a próxima lixeira
// (ou para o aviso de lista vazia) e, ao desfazer, volta para a lixeira do item restaurado.
export function UndoDeleteDemo() {
  const [items, setItems] = useState<Item[]>(SAMPLE);
  const listRef = useRef<HTMLUListElement>(null);
  const emptyRef = useRef<HTMLParagraphElement>(null);

  const trashButton = (id: number) =>
    listRef.current?.querySelector<HTMLButtonElement>(`[data-item-id="${id}"]`);

  function remove(item: Item) {
    const index = items.findIndex((i) => i.id === item.id);
    const rest = items.filter((i) => i.id !== item.id);
    // Próximo item; se era o último da lista, o anterior
    const neighbor = rest[index] ?? rest[index - 1];
    setItems(rest);

    undoToast(`"${item.description}" excluído`, {
      onUndo: () => {
        setItems((current) => [...current, item].sort((a, b) => a.id - b.id));
        focusAfterToast(() => trashButton(item.id));
      },
    });
    focusAfterToast(() => (neighbor ? trashButton(neighbor.id) : emptyRef.current));
  }

  return (
    <div>
      <ul ref={listRef} className="bg-card divide-y rounded-xl border empty:hidden">
        {items.map((item) => (
          <li key={item.id} className="flex items-center justify-between gap-3 px-4 py-3">
            <span className="min-w-0 truncate">{item.description}</span>
            <span className="flex items-center gap-2">
              <AmountText cents={item.cents} />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                data-item-id={item.id}
                onClick={() => remove(item)}
                aria-label={`Excluir ${item.description}`}
              >
                <Trash2 aria-hidden />
              </Button>
            </span>
          </li>
        ))}
      </ul>
      {items.length === 0 ? (
        // tabIndex={-1}: pode receber o foco pelo código, mas não entra na ordem do Tab
        <p
          ref={emptyRef}
          tabIndex={-1}
          className="text-muted-foreground focus-visible:ring-ring rounded-xl border px-4 py-3 text-sm outline-none focus-visible:ring-3"
        >
          Lista vazia. Use &quot;Desfazer&quot; no aviso (Alt+T leva até ele).
        </p>
      ) : null}
    </div>
  );
}
