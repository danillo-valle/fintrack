"use client";

// O tipo de um lançamento que já existe (M13.3c, ADR-027; canvas O-Parcelada, O-ReceitaFixa e
// O-CelTipo):
//
//   saída     Fixa (repete todo mês: o valor e o dia) | Variável | Parcelada (a parcela e o total)
//   entrada   Fixa (repete todo mês) | Variável
//
// Um formulário só, com a Server Action direta (funciona antes do JavaScript): o painel de cada
// tipo aparece pelo rádio marcado (CSS :has). O JavaScript só acrescenta a conta ao vivo da
// Parcelada (o total e a linha das parcelas). "As próximas desta loja também" vale na saída.
import { useId, useState } from "react";
import { Layers, Repeat, Waves } from "lucide-react";
import { addMonthsToKey, STATED_INSTALLMENTS_MAX } from "@fintrack/core";
import { ActionForm } from "@/components/feedback/action-form";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { formatBRL } from "@/lib/money";
import { NATIVE_CHECK } from "@/lib/styles";
import { cn } from "@/lib/utils";
import { monthName } from "../../presentation";
import { setEntryTypeAction } from "../../server/actions";
import type { EntryTypeView } from "../../server/queries";
import { RepeatSettingsFields } from "./repeat-settings-fields";
import { ParcelTrack } from "./parcel-track";

type EntryType = EntryTypeView["current"];

const OPTIONS: { value: EntryType; label: string; icon: typeof Repeat }[] = [
  { value: "FIXED", label: "Fixa", icon: Repeat },
  { value: "VARIABLE", label: "Variável", icon: Waves },
  { value: "INSTALLMENT", label: "Parcelada", icon: Layers },
];

const dayMonth = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  timeZone: "UTC",
});

export function EntryTypeForm({
  transactionId,
  view,
  canRemember,
}: {
  transactionId: string;
  view: EntryTypeView;
  /** A pessoa pode criar a regra da loja (e o lançamento tem categoria) */
  canRemember: boolean;
}) {
  const prefix = useId();
  const options = OPTIONS.filter((o) => {
    if (o.value === "INSTALLMENT") return view.installment.allowed;
    return view.repeat.allowed || o.value === view.current;
  });
  const legend = view.expense ? "Tipo da despesa" : "Tipo da receita";
  return (
    <ActionForm action={setEntryTypeAction} idPrefix={prefix} aria-label={legend}>
      {({ pending, field }) => (
        <div
          className={cn(
            "flex flex-col gap-4",
            // O painel de cada tipo aparece com o rádio dele marcado
            "[&:has(input[name=type][value=FIXED]:checked)_[data-panel=FIXED]]:flex",
            "[&:has(input[name=type][value=INSTALLMENT]:checked)_[data-panel=INSTALLMENT]]:flex",
          )}
        >
          <input type="hidden" name="transactionId" value={transactionId} />
          <FieldSet className="gap-2">
            <FieldLegend variant="label">{legend}</FieldLegend>
            <div className="flex gap-2">
              {options.map(({ value, label, icon: Icon }) => (
                <label
                  key={value}
                  htmlFor={`${prefix}type-${value}`}
                  className="has-focus-visible:ring-ring bg-background has-checked:border-chart-1 flex h-11 min-w-0 flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-xl border text-sm font-medium whitespace-nowrap has-checked:border-2 has-checked:bg-[color-mix(in_srgb,var(--chart-1)_10%,transparent)] has-checked:font-bold has-focus-visible:ring-3"
                >
                  <input
                    id={`${prefix}type-${value}`}
                    type="radio"
                    name="type"
                    value={value}
                    defaultChecked={view.current === value}
                    className="sr-only"
                  />
                  <Icon aria-hidden className="size-4" />
                  {label}
                </label>
              ))}
            </div>
          </FieldSet>

          {view.repeat.allowed ? (
            <section
              data-panel="FIXED"
              aria-label="Repete todo mês"
              className="bg-muted/50 hidden flex-col gap-3 rounded-2xl border p-3.5"
            >
              <p className="flex items-center gap-2 font-bold">
                <Repeat aria-hidden className="size-4.5" />
                {view.expense ? "Sai" : "Entra"} todo mês {view.expense ? "de" : "na"}{" "}
                {view.repeat.accountName}
              </p>
              <RepeatSettingsFields
                idPrefix={prefix}
                settings={view.repeat.settings}
                previews={view.repeat.previews}
                field={field}
              />
              {view.repeat.lastArrivals.length > 0 ? (
                <div>
                  <h3 className="text-sm font-bold">Os últimos que chegaram</h3>
                  <ul className="mt-1.5 divide-y border-t text-sm">
                    {view.repeat.lastArrivals.map((a) => (
                      <li key={a.occurredOn} className="flex justify-between gap-3 py-1.5">
                        <span>{dayMonth.format(new Date(`${a.occurredOn}T12:00:00Z`))}</span>
                        <span className="tabular font-mono font-semibold">
                          {formatBRL(a.amount)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              <p className="text-muted-foreground text-[0.8125rem]">
                Quando {view.expense ? "a cobrança" : "a entrada"} chega do banco, ela toma o lugar
                da prevista. Se vier diferente, a tela mostra quanto: o valor pode variar.
              </p>
            </section>
          ) : null}

          {view.installment.allowed ? (
            <InstallmentPanel prefix={prefix} view={view} field={field} />
          ) : null}

          {view.expense && canRemember ? (
            <label className="flex min-h-11 cursor-pointer items-start gap-2.5 text-sm">
              <input
                type="checkbox"
                name="rememberRule"
                className={cn(NATIVE_CHECK, "mt-0.5 size-5")}
              />
              <span>
                {/* Nome próprio: o Editar logo abaixo tem o "As próximas de … também" da categoria */}
                <strong>Este tipo também nas próximas de “{view.originText}”</strong>
                <span className="text-muted-foreground block text-[0.8125rem]">
                  a regra da loja passa a dar esta categoria e este tipo ao que chegar do banco
                </span>
              </span>
            </label>
          ) : null}

          <div className="flex justify-end">
            <Button type="submit" disabled={pending} className="h-11 rounded-xl font-bold">
              Salvar o tipo
            </Button>
          </div>
        </div>
      )}
    </ActionForm>
  );
}

function InstallmentPanel({
  prefix,
  view,
  field,
}: {
  prefix: string;
  view: EntryTypeView;
  field: Parameters<typeof RepeatSettingsFields>[0]["field"];
}) {
  const stated = view.installment.stated;
  const [number, setNumber] = useState(stated?.number ?? 1);
  const [count, setCount] = useState(stated?.count ?? 2);
  const numberField = field("installmentNumber");
  const countField = field("installmentCount");
  const valid = Number.isInteger(number) && Number.isInteger(count) && number >= 1 && count >= 2;
  const remaining = valid && count > number ? count - number : 0;
  return (
    <section
      data-panel="INSTALLMENT"
      aria-label="As parcelas desta compra"
      className="hidden flex-col gap-3"
    >
      <div className="grid grid-cols-3 gap-3">
        <Field data-invalid={numberField.error ? true : undefined}>
          <FieldLabel htmlFor={`${prefix}installmentNumber`}>Parcela</FieldLabel>
          <Input
            id={`${prefix}installmentNumber`}
            name="installmentNumber"
            type="text"
            inputMode="numeric"
            pattern="[1-9][0-9]?"
            defaultValue={String(stated?.number ?? 1)}
            onChange={(e) => setNumber(Number(e.target.value))}
            data-msg-pattern="Use a parcela, de 1 até o total."
            className="h-11"
            {...numberField.props}
          />
          <FieldError id={numberField.errorId}>{numberField.error}</FieldError>
        </Field>
        <Field data-invalid={countField.error ? true : undefined}>
          <FieldLabel htmlFor={`${prefix}installmentCount`}>de</FieldLabel>
          <Input
            id={`${prefix}installmentCount`}
            name="installmentCount"
            type="text"
            inputMode="numeric"
            pattern="([2-9]|[1-9][0-9])"
            defaultValue={String(stated?.count ?? 2)}
            onChange={(e) => setCount(Number(e.target.value))}
            data-msg-pattern={`Use de 2 a ${STATED_INSTALLMENTS_MAX} parcelas.`}
            className="h-11"
            {...countField.props}
          />
          <FieldError id={countField.errorId}>{countField.error}</FieldError>
        </Field>
        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium">Total da compra</span>
          <output
            htmlFor={`${prefix}installmentCount`}
            className="bg-muted text-muted-foreground tabular flex h-11 items-center rounded-xl px-3 font-mono text-sm"
          >
            {valid ? formatBRL(view.perParcel * BigInt(count)) : "—"}
          </output>
        </div>
      </div>
      <p className="text-muted-foreground text-[0.8125rem]">
        O banco não informou a parcela desta compra: você preenche aqui. A cobrança do mês seguinte,
        da mesma loja e valor, vira a parcela seguinte sozinha.
      </p>
      {valid && number <= count ? (
        <>
          <ParcelTrack number={number} count={count} dueMonth={view.dueMonth} />
          <p
            aria-live="polite"
            className="border-chart-1 rounded-[0.875rem] border bg-[color-mix(in_srgb,var(--chart-1)_10%,transparent)] px-3.5 py-3 text-sm"
          >
            {remaining > 0
              ? `${remaining === 1 ? "A que falta fica prevista" : `As ${remaining} que faltam ficam previstas`} nas próximas faturas, até ${monthName(addMonthsToKey(view.dueMonth, remaining)).toLowerCase()}: ${formatBRL(view.perParcel * BigInt(remaining))} ainda a pagar. Quando o banco trouxer cada uma, ela toma o lugar da prevista.`
              : "Esta é a última parcela: nada fica previsto."}
          </p>
        </>
      ) : null}
    </section>
  );
}
