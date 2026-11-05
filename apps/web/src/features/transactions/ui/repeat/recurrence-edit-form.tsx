"use client";

// Mudar o valor (M13.3c, Fixas e parcelas, ⋯): a regra do valor, o dia e o fim de uma
// recorrência, com as últimas que chegaram. A do app só tem valor fixo (ela gera o lançamento). O
// botão fica no rodapé (form="…"); dando certo, a action volta para a lista com o aviso no topo.
import type { CivilDate, RecurrenceSettings } from "@fintrack/core";
import { ActionForm } from "@/components/feedback/action-form";
import { formatBRL } from "@/lib/money";
import { updateRecurrenceAction } from "../../server/actions";
import type { FixedRecurrence } from "../../server/queries";
import { RepeatSettingsFields } from "./repeat-settings-fields";

const dayMonth = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  timeZone: "UTC",
});
const at = (d: CivilDate) => new Date(`${d}T12:00:00Z`);

export function RecurrenceEditForm({
  formId,
  recurrence: r,
}: {
  formId: string;
  recurrence: FixedRecurrence;
}) {
  const positive = (c: bigint) => (c < 0n ? -c : c);
  const settings: RecurrenceSettings = {
    amountRule: r.amountRule,
    fixed: r.amountRule === "FIXED" ? positive(r.amount) : null,
    dayRule: r.dayRule,
    day: r.dayOfMonth,
    endsOn: r.endsOn,
  };
  return (
    <ActionForm
      action={updateRecurrenceAction}
      id={formId}
      idPrefix={`${formId}-`}
      aria-label={`Mudar o valor de ${r.description}`}
      className="flex flex-col gap-4"
    >
      {({ field }) => (
        <>
          <input type="hidden" name="walletId" value={r.walletId} />
          <input type="hidden" name="recurrenceId" value={r.id} />
          <RepeatSettingsFields
            idPrefix={`${formId}-`}
            settings={settings}
            previews={r.previews}
            onlyFixed={r.origin === "APP"}
            field={field}
          />
          {r.lastArrivals.length > 0 ? (
            <div>
              <h3 className="text-sm font-bold">Os últimos que chegaram</h3>
              <ul className="mt-1.5 divide-y border-t text-sm">
                {r.lastArrivals.map((a) => (
                  <li key={a.occurredOn} className="flex justify-between gap-3 py-1.5">
                    <span>{dayMonth.format(at(a.occurredOn))}</span>
                    <span className="tabular font-mono font-semibold">
                      {formatBRL(positive(a.amount))}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <p className="text-muted-foreground text-[0.8125rem]">
            {r.origin === "APP"
              ? "O FinTrack lança esta todo mês, agendada, pelo valor fixo. O que já foi lançado continua."
              : "O banco traz esta todo mês: o valor e o dia aqui são só a previsão. Quando ela chega, toma o lugar da prevista."}
          </p>
        </>
      )}
    </ActionForm>
  );
}
