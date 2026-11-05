import type { ExpenseNature } from "@fintrack/core";
import { FieldDescription, FieldLegend, FieldSet } from "@/components/ui/field";
import { cn } from "@/lib/utils";
import { NATURE_ICON } from "./nature-tag";
import { NATIVE_CHECK } from "@/lib/styles";

// Fixa ou variável num formulário (M13.3b, ADR-026). Dois jeitos, do canvas linha N:
//   cards       um cartão por opção, com a frase do que ela quer dizer (Editar lançamento,
//               Editar categoria, a etiqueta da lista)
//   segmented   dois botões lado a lado (o painel da categoria na revisão, onde o espaço é curto)
// Rádios nativos (o formulário funciona antes do JavaScript). Numa compra, `before` vai junto
// (natureBefore): o servidor só grava o que a pessoa TROCOU (natureChoiceSchema).
export type NatureOption = { value: ExpenseNature; label: string; hint?: string };

const KIND: Record<ExpenseNature, "fixed" | "variable"> = { FIXED: "fixed", VARIABLE: "variable" };

export function NatureRadios({
  name,
  legend,
  options,
  value,
  before,
  description,
  variant = "cards",
  idPrefix,
  className,
}: {
  name: string;
  legend: string;
  options: readonly NatureOption[];
  /** A opção marcada ao abrir */
  value: ExpenseNature;
  /** O tipo de antes (só numa compra): vai como natureBefore */
  before?: ExpenseNature;
  description?: React.ReactNode;
  variant?: "cards" | "segmented";
  idPrefix: string;
  className?: string;
}) {
  return (
    <FieldSet className={cn("gap-2", className)}>
      <FieldLegend variant="label">{legend}</FieldLegend>
      {before ? <input type="hidden" name="natureBefore" value={before} /> : null}
      <div className={cn("flex gap-2", variant === "cards" && "flex-col gap-2.5 sm:flex-row")}>
        {options.map((o) => {
          const Icon = NATURE_ICON[KIND[o.value]];
          const id = `${idPrefix}${name}-${o.value}`;
          return variant === "cards" ? (
            <label
              key={o.value}
              htmlFor={id}
              className="has-focus-visible:ring-ring bg-background has-checked:border-chart-1 flex min-w-0 flex-1 cursor-pointer items-start gap-2.5 rounded-[0.875rem] border px-3.5 py-3 has-checked:border-2 has-checked:bg-[color-mix(in_srgb,var(--chart-1)_10%,transparent)] has-focus-visible:ring-3"
            >
              <input
                id={id}
                type="radio"
                name={name}
                value={o.value}
                defaultChecked={value === o.value}
                className={cn(NATIVE_CHECK, "mt-0.5 size-[1.125rem] rounded-full")}
              />
              <span className="flex min-w-0 flex-col gap-0.5">
                <strong className="text-[0.9375rem]">{o.label}</strong>
                {o.hint ? (
                  <span className="text-muted-foreground text-[0.8125rem]">{o.hint}</span>
                ) : null}
              </span>
            </label>
          ) : (
            <label
              key={o.value}
              htmlFor={id}
              className="has-focus-visible:ring-ring bg-background has-checked:border-chart-1 flex h-11 flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-xl border text-sm font-medium has-checked:border-2 has-checked:bg-[color-mix(in_srgb,var(--chart-1)_10%,transparent)] has-checked:font-bold has-focus-visible:ring-3"
            >
              <input
                id={id}
                type="radio"
                name={name}
                value={o.value}
                defaultChecked={value === o.value}
                className="sr-only"
              />
              <Icon aria-hidden className="size-4" />
              {o.label}
            </label>
          );
        })}
      </div>
      {description ? <FieldDescription>{description}</FieldDescription> : null}
    </FieldSet>
  );
}

/** As frases de uma compra (Editar lançamento e a etiqueta da lista). */
export const PURCHASE_NATURE_OPTIONS: readonly NatureOption[] = [
  {
    value: "FIXED",
    label: "Fixa",
    hint: "todo mês, quase o mesmo valor: entra uma vez no previsto",
  },
  { value: "VARIABLE", label: "Variável", hint: "muda com o uso: entra no ritmo do mês" },
];

/** As frases curtas do painel da categoria (os dois botões lado a lado). */
export const SHORT_NATURE_OPTIONS: readonly NatureOption[] = [
  { value: "FIXED", label: "Fixa" },
  { value: "VARIABLE", label: "Variável" },
];

/** "Padrão de Assinaturas: Fixa." ou, sem categoria, de onde vem o tipo. */
export function natureDefaultText(
  category: { name: string } | null,
  categoryNature: ExpenseNature | null,
) {
  return category
    ? `Padrão de ${category.name}: ${categoryNature === "FIXED" ? "Fixa" : "Variável"}. Uma compra parcelada é sempre Parcela.`
    : "Sem categoria, a compra é variável até você escolher. Uma compra parcelada é sempre Parcela.";
}
