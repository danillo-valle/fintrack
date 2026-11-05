"use client";

// O valor e o dia de uma recorrência (M13.3c, ADR-027; canvas O-ReceitaFixa): como prever o valor
// (o último, a média de 3 meses ou um valor fixo), quando cai (o dia do mês ou o N-ésimo dia útil)
// e até quando. Usado em "Repete todo mês" (o tipo do lançamento) e em Mudar o valor (Fixas e
// parcelas). Campos nativos: o formulário funciona antes do JavaScript; o campo do valor fixo só
// aparece com "Um valor fixo" (CSS :has), e o servidor ignora o valor nas outras regras.
import type { CivilDate, RecurrenceAmountRule, RecurrenceSettings } from "@fintrack/core";
import { BUSINESS_DAY_MAX, RECURRENCE_AMOUNT_RULES } from "@fintrack/core";
import { MoneyInput } from "@/components/money/money-input";
import { Field, FieldError, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { formatBRL } from "@/lib/money";
import { NATIVE_CHECK } from "@/lib/styles";
import { cn } from "@/lib/utils";
import { AMOUNT_RULE_LABEL } from "../../repeat-text";

type FieldHelper = (name: string) => {
  props: Record<string, unknown>;
  error: string | undefined;
  errorId: string;
};

/** O valor que cada regra daria agora (null: a regra não tem prévia, como o valor fixo). */
export type RulePreviews = Partial<Record<RecurrenceAmountRule, bigint>>;

export function RepeatSettingsFields({
  idPrefix,
  settings,
  previews,
  onlyFixed = false,
  field,
}: {
  idPrefix: string;
  settings: RecurrenceSettings;
  previews: RulePreviews;
  /** A recorrência do app só tem valor fixo (ela gera o lançamento) */
  onlyFixed?: boolean;
  field: FieldHelper;
}) {
  const rules = onlyFixed ? (["FIXED"] as const) : RECURRENCE_AMOUNT_RULES;
  const fixed = field("fixed");
  const day = field("day");
  const id = (name: string) => `${idPrefix}${name}`;
  return (
    <div className="flex flex-col gap-3 [&:has(input[name=amountRule][value=FIXED]:checked)_[data-fixed-amount]]:flex">
      <FieldSet className="gap-2">
        <FieldLegend variant="label">Valor previsto</FieldLegend>
        <div className="grid gap-2 sm:grid-cols-3">
          {rules.map((rule) => {
            const preview = previews[rule];
            return (
              <label
                key={rule}
                htmlFor={id(`rule-${rule}`)}
                className="has-focus-visible:ring-ring bg-background has-checked:border-chart-1 flex min-h-11 cursor-pointer items-start gap-2.5 rounded-xl border px-3 py-2.5 has-checked:border-2 has-checked:bg-[color-mix(in_srgb,var(--chart-1)_10%,transparent)] has-focus-visible:ring-3"
              >
                <input
                  id={id(`rule-${rule}`)}
                  type="radio"
                  name="amountRule"
                  value={rule}
                  defaultChecked={settings.amountRule === rule || onlyFixed}
                  className={cn(NATIVE_CHECK, "mt-0.5 size-[1.125rem] shrink-0 rounded-full")}
                />
                <span className="flex min-w-0 flex-col gap-0.5">
                  <strong className="text-[0.875rem]">{AMOUNT_RULE_LABEL[rule]}</strong>
                  <span className="text-muted-foreground tabular font-mono text-[0.8125rem]">
                    {preview !== undefined ? formatBRL(preview) : "você digita"}
                  </span>
                </span>
              </label>
            );
          })}
        </div>
      </FieldSet>
      <Field data-fixed-amount data-invalid={fixed.error ? true : undefined} className="hidden">
        <FieldLabel htmlFor={id("fixed")}>Valor fixo</FieldLabel>
        <MoneyInput
          id={id("fixed")}
          name="fixed"
          defaultValue={settings.fixed ?? previews.LAST ?? 0n}
          className="h-11 max-w-48"
          {...fixed.props}
        />
        <FieldError id={fixed.errorId}>{fixed.error}</FieldError>
      </Field>
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1.2fr)_minmax(0,0.6fr)_minmax(0,1fr)]">
        <Field>
          <FieldLabel htmlFor={id("dayRule")}>Quando cai</FieldLabel>
          <NativeSelect
            id={id("dayRule")}
            name="dayRule"
            defaultValue={settings.dayRule}
            className="h-11"
          >
            <option value="DAY">Por volta do dia</option>
            <option value="BUSINESS_DAY">No dia útil</option>
          </NativeSelect>
        </Field>
        <Field data-invalid={day.error ? true : undefined}>
          <FieldLabel htmlFor={id("day")}>Dia</FieldLabel>
          <Input
            id={id("day")}
            name="day"
            type="text"
            inputMode="numeric"
            required
            pattern="([1-9]|[12][0-9]|3[01])"
            defaultValue={String(settings.day)}
            data-msg-pattern={`Use um dia de 1 a 31 (o dia útil vai até o ${BUSINESS_DAY_MAX}º).`}
            className="h-11"
            {...day.props}
          />
          <FieldError id={day.errorId}>{day.error}</FieldError>
        </Field>
        <Field>
          <FieldLabel htmlFor={id("endsOn")}>Até quando (mês)</FieldLabel>
          <Input
            id={id("endsOn")}
            name="endsOn"
            type="month"
            defaultValue={monthOfEnd(settings.endsOn)}
            aria-describedby={id("endsOn-help")}
            className="h-11 focus-within:ring-3"
          />
          <span id={id("endsOn-help")} className="text-muted-foreground text-[0.8125rem]">
            Vazio: sem data para acabar
          </span>
        </Field>
      </div>
    </div>
  );
}

const monthOfEnd = (endsOn: CivilDate | null) => (endsOn ? endsOn.slice(0, 7) : "");
