"use client";

// Recebidos › Do WhatsApp (M11): as propostas do bot que esperam o Confirmar DESTA pessoa. Ficam
// fora das somas (ainda não são lançamentos). Confirmar aqui faz o mesmo que o botão do WhatsApp:
// cria o lançamento pelo caminho do formulário. Cancelar descarta a proposta.
//
// O estado da action mora no topo da seção (a linha confirmada some na mesma resposta) e o aviso
// sai como toast; cada botão é um <form> com a action do useActionState, então funciona antes do
// React carregar (regra do M08).
import { useActionState, useEffect, useRef } from "react";
import Link from "next/link";
import { Check, MessageCircle, X } from "lucide-react";
import { toast } from "sonner";
import { AmountText } from "@/components/money/amount-text";
import { Button } from "@/components/ui/button";
import { INITIAL_ACTION_STATE } from "@/lib/action-state";
import { TEXT_LINK } from "@/lib/styles";
import { cn } from "@/lib/utils";
import { botDraftAction } from "../server/actions";
import type { OpenDraft } from "../server/queries";

const METHOD: Record<string, string> = { CREDIT: "crédito", DEBIT: "débito", PIX: "pix" };
const dayMonth = (date: string) => `${date.slice(8, 10)}/${date.slice(5, 7)}`;

export function BotDrafts({ drafts }: { drafts: OpenDraft[] }) {
  const [state, formAction, pending] = useActionState(botDraftAction, INITIAL_ACTION_STATE);
  const shown = useRef(state);
  useEffect(() => {
    if (state === shown.current) return;
    shown.current = state;
    if (state.error) toast.error(state.error);
    else if (state.success) toast.success(state.success);
  }, [state]);

  if (drafts.length === 0) return null;
  return (
    <section
      aria-labelledby="do-whatsapp"
      className="flex flex-col gap-3"
      data-testid="do-whatsapp"
    >
      <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5">
        <h2
          id="do-whatsapp"
          className="inline-flex items-center gap-2 text-lg font-extrabold md:text-xl"
        >
          <MessageCircle aria-hidden className="text-chart-2-ink size-5" />
          Do WhatsApp
        </h2>
        <span className="text-muted-foreground text-sm">
          {drafts.length === 1
            ? "1 proposta esperando o seu Confirmar"
            : `${drafts.length} propostas esperando o seu Confirmar`}
        </span>
      </div>
      {/* Sem JavaScript, o resultado aparece aqui (com ele, vira toast) */}
      <noscript>
        {state.error || state.success ? (
          <p className="text-sm font-semibold">{state.error ?? state.success}</p>
        ) : null}
      </noscript>
      <ul className="bg-card divide-y overflow-hidden rounded-2xl border">
        {drafts.map((draft) => {
          const what = draft.category ?? draft.description;
          return (
            <li
              key={draft.id}
              className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 px-4 py-3 md:grid-cols-[3.5rem_minmax(0,1fr)_auto_auto]"
              data-testid="proposta-whatsapp"
            >
              <span className="text-muted-foreground hidden font-mono text-sm tabular-nums md:block">
                {dayMonth(draft.occurredOn)}
              </span>
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="font-medium break-words">
                  {what}
                  {draft.installments ? ` · ${draft.installments}x` : ""}
                </span>
                <span className="text-muted-foreground text-[0.8125rem] break-words">
                  <span className="md:hidden">{dayMonth(draft.occurredOn)} · </span>
                  {draft.complete
                    ? `${METHOD[draft.method] ?? draft.method}${draft.payWith ? `, ${draft.payWith}` : ""} · ${draft.wallet ?? "—"}`
                    : "Falta escolher o ambiente ou o cartão (o bot perguntou no WhatsApp)"}
                  {draft.expired ? " · os botões do WhatsApp venceram" : ""}
                </span>
              </span>
              <AmountText cents={-draft.cents} className="justify-self-end text-sm" />
              <div className="col-span-2 flex flex-wrap justify-end gap-2 md:col-span-1">
                {draft.complete ? (
                  <form action={formAction}>
                    <input type="hidden" name="draftId" value={draft.id} />
                    <input type="hidden" name="intent" value="confirmar" />
                    <Button
                      type="submit"
                      disabled={pending}
                      aria-label={`Confirmar ${what}`}
                      className="h-11 rounded-[0.625rem] px-3 text-[0.8125rem] font-bold md:h-9"
                    >
                      <Check aria-hidden />
                      Confirmar
                    </Button>
                  </form>
                ) : null}
                <form action={formAction}>
                  <input type="hidden" name="draftId" value={draft.id} />
                  <input type="hidden" name="intent" value="cancelar" />
                  <Button
                    type="submit"
                    variant="outline"
                    disabled={pending}
                    aria-label={`Cancelar a proposta ${what}`}
                    className="h-11 rounded-[0.625rem] px-3 text-[0.8125rem] font-semibold md:h-9"
                  >
                    <X aria-hidden />
                    Cancelar
                  </Button>
                </form>
              </div>
            </li>
          );
        })}
      </ul>
      <p className="text-muted-foreground text-[0.8125rem]">
        Ainda não são lançamentos: não entram nas somas. Os padrões do bot ficam em{" "}
        <Link href="/ajustes/bot" className={cn(TEXT_LINK, "font-semibold")}>
          Ajustes › Bot do WhatsApp
        </Link>
        .
      </p>
    </section>
  );
}
