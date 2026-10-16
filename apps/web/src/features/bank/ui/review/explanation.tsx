// "Por que essa categoria?" (M10.1, pranchas F-Sugestoes e F-CelSugestoes): a cascata de um
// recebido, camada por camada, na ordem em que ela pergunta. A camada que decidiu aparece
// marcada ("Decidiu", texto e fundo: a cor nunca é o único sinal); as de depois, "Não precisou".
//
//   [≡] 1 · Regras          Nenhuma regra combinou
//   [⟲] 2 · Histórico       1 lançamento parecido nas carteiras que você vê (precisa de 2)
//   [🏛] 3 · Banco           O banco não mandou categoria
//   [▣] 4 · Classificador   Decidiu · Restaurantes, 92 % de confiança (sugere a partir de 80 %)
//
// Igual no modal e na página inteira. O formulário do "Confirmar" é o ExplanationConfirmForm.
import type { SuggestionSource } from "@fintrack/core";
import type { ExplanationPage } from "../../server/review";
import { SOURCE_ICON, SourcePill } from "@/components/visual/source-pill";
import { SOURCE_LABEL } from "@/lib/labels";
import { formatBRL } from "@/lib/money";
import { cn } from "@/lib/utils";
import { dayMonth } from "./parts";

const LAYER_NAME: Record<SuggestionSource, string> = {
  RULE: "Regras",
  HISTORY: "Histórico",
  PROVIDER: "Banco",
  CLASSIFIER: "Classificador",
};

/** O título: "Por que Restaurantes?" ou, sem categoria, "Por que ficou sem categoria?" */
export function explanationTitle(page: ExplanationPage) {
  const category = page.transaction.category;
  return category ? `Por que ${category.name}?` : "Por que ficou sem categoria?";
}

/** "RESTAURANTE SABOR CASEIRO · 13/10 · − R$ 96,00" */
export function explanationSubtitle(page: ExplanationPage) {
  const t = page.transaction;
  const sign = t.amount < 0n ? "− " : "+ ";
  return `${t.description} · ${dayMonth(t.occurredOn)} · ${sign}${formatBRL(t.amount < 0n ? -t.amount : t.amount)}`;
}

export function ExplanationBody({ page }: { page: ExplanationPage }) {
  const t = page.transaction;
  const automatic = t.categorizedBy !== null && t.categorizedBy !== "MANUAL";
  const changed =
    automatic && page.suggested !== null && page.suggested.categoryId !== t.category?.id;
  // Mesma categoria, outra camada: a busca usou uma, e hoje outra responde primeiro
  const otherLayer =
    automatic &&
    !changed &&
    page.suggested !== null &&
    page.suggested.source !== t.categorizedBy &&
    t.categorizedBy !== null;
  return (
    <div className="flex flex-col gap-3">
      {t.category && t.categorizedBy ? (
        <p className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted-foreground">Gravado:</span>
          <span className="font-semibold">{t.category.name}</span>
          <SourcePill source={t.categorizedBy} confidence={t.confidence} />
        </p>
      ) : null}
      {t.categorizedBy === "MANUAL" ? (
        <p className="text-muted-foreground text-sm">
          Você escolheu esta categoria. Abaixo, o que a cascata sugeriria hoje.
        </p>
      ) : null}
      {changed && page.suggested ? (
        <p className="text-muted-foreground text-sm">
          Hoje a cascata sugeriria{" "}
          <strong className="text-foreground">{page.suggested.name}</strong> (uma regra nova, mais
          histórico ou um treino desde a busca).
        </p>
      ) : null}
      {otherLayer && page.suggested && t.categorizedBy ? (
        <p className="text-muted-foreground text-sm">
          Hoje quem responde primeiro é: {SOURCE_LABEL[page.suggested.source]} (quando o lançamento
          chegou, foi: {SOURCE_LABEL[t.categorizedBy]}).
        </p>
      ) : null}
      <ol aria-label="As camadas da cascata, em ordem" className="flex flex-col gap-0.5">
        {page.layers.map((layer, index) => {
          const Icon = SOURCE_ICON[layer.source];
          const decided = layer.state === "DECIDED";
          return (
            <li
              key={layer.source}
              data-state={layer.state}
              className={cn(
                "grid grid-cols-[2rem_minmax(0,1fr)] gap-2.5 p-2.5",
                index > 0 && !decided && "border-t",
                decided && "rounded-xl bg-[color-mix(in_srgb,var(--chart-1)_14%,transparent)]",
              )}
            >
              <span
                className={cn(
                  "bg-muted grid size-8 place-items-center rounded-[0.5625rem]",
                  decided ? "text-chart-1-ink" : "text-muted-foreground",
                )}
              >
                <Icon aria-hidden className="size-4" />
              </span>
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="flex items-baseline justify-between gap-2">
                  <strong className={cn("text-sm", decided ? "font-bold" : "font-semibold")}>
                    {index + 1} · {LAYER_NAME[layer.source]}
                  </strong>
                  {decided ? (
                    <span className="text-chart-1-ink text-xs font-bold">Decidiu</span>
                  ) : null}
                </span>
                <span className="text-muted-foreground text-[0.8125rem]">
                  {layer.state === "SKIPPED" ? "Não precisou" : layer.detail}
                </span>
              </span>
            </li>
          );
        })}
      </ol>
      <p className="text-muted-foreground text-[0.8125rem]">
        Confirmar ou corrigir vira exemplo de treino. A descrição do lançamento não sai do servidor
        de casa.
      </p>
    </div>
  );
}
