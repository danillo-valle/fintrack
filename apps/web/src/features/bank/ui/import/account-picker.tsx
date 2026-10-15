"use client";

// "Entra na conta" (M09.3, pranchas E3-Conferir e E3-Cartao). É um formulário GET (?conta=):
// trocar a conta recarrega a conferência com o estado de cada linha NAQUELA conta (o que já
// veio pelo Meu Pluggy depende da conta). Funciona sem JavaScript pelo botão "Ver nesta conta".
import Form from "next/form";
import { CircleCheck } from "lucide-react";
import type { ImportAccountSuggestion } from "@fintrack/core";
import { NativeSelect } from "@/components/ui/native-select";

type Option = { id: string; name: string; cardLastFours: readonly string[] };

const REASON: Record<ImportAccountSuggestion["reason"], (lastFour: string | null) => string> = {
  LEARNED: (lastFour) =>
    lastFour ? `sugerida: o último arquivo deste final (${lastFour}) entrou nela` : "sugerida",
  CARD_LAST_FOUR: (lastFour) => `sugerida pelo final do cartão (${lastFour ?? ""})`,
  ONLY_ONE: () => "sugerida: a única conta deste tipo",
};

export function optionLabel(option: Option) {
  return option.cardLastFours.length > 0
    ? `${option.name} · final ${option.cardLastFours.join(", ")}`
    : option.name;
}

export function AccountPicker({
  action,
  options,
  current,
  suggestion,
  lastFour,
  chosenByYou,
}: {
  action: string;
  /** A pessoa trocou a conta (?conta=); senão é a sugerida ou a primeira da lista */
  chosenByYou: boolean;
  options: readonly Option[];
  current: string;
  suggestion: ImportAccountSuggestion | null;
  lastFour: string | null;
}) {
  const suggested = suggestion?.accountId === current;
  return (
    <Form action={action} replace scroll={false} className="flex max-w-[28.75rem] flex-col gap-1.5">
      <label htmlFor="conta" className="text-sm font-semibold">
        Entra na conta
      </label>
      <NativeSelect
        id="conta"
        name="conta"
        defaultValue={current}
        aria-describedby="conta-ajuda"
        onChange={(event) => event.currentTarget.form?.requestSubmit()}
        className="h-11 rounded-xl px-3 text-[0.9375rem] font-medium"
      >
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {optionLabel(o)}
          </option>
        ))}
      </NativeSelect>
      <span
        id="conta-ajuda"
        className="text-chart-5-ink inline-flex items-center gap-1.5 text-[0.8125rem]"
      >
        {suggested && suggestion ? (
          <>
            <CircleCheck aria-hidden className="size-3.5" />
            {REASON[suggestion.reason](lastFour)}
          </>
        ) : (
          <span className="text-muted-foreground">
            {chosenByYou
              ? "Escolhida por você. Da próxima vez, o FinTrack sugere esta."
              : "Confira a conta. Da próxima vez, o FinTrack sugere a que você escolher."}
          </span>
        )}
      </span>
      <noscript>
        <button type="submit" className="text-sm font-semibold underline">
          Ver nesta conta
        </button>
      </noscript>
    </Form>
  );
}
