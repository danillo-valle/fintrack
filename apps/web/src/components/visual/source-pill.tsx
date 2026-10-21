import {
  Cpu,
  History,
  Landmark,
  Sparkles,
  TextAlignStart,
  UserRound,
  type LucideIcon,
} from "lucide-react";
import type { CategorizationSource } from "@fintrack/core";
import { SOURCE_LABEL } from "@/lib/labels";
import { cn } from "@/lib/utils";

// Quem sugeriu a categoria (M10.1, prancha F-Sugestoes): ícone + nome da camada + confiança.
//
//   [≡ Regra]  [⟲ Histórico]  [🏛 Banco 100 %]  [▣ Classificador 92 %]  [✦ IA local]  [👤 Você]
//
// O texto sempre diz a camada; o ícone só reforça (cor nunca é o único sinal, WCAG 1.4.1). As
// cores são as do texto secundário sobre o fundo neutro (par conferido no theme-contrast.test).
export const SOURCE_ICON: Record<CategorizationSource, LucideIcon> = {
  RULE: TextAlignStart,
  HISTORY: History,
  PROVIDER: Landmark,
  CLASSIFIER: Cpu,
  LLM: Sparkles,
  MANUAL: UserRound,
};

/** "92 %": a confiança como a tela mostra (a regra é sempre 100; a IA local não tem: não diz). */
export function confidenceText(source: CategorizationSource, confidence: number | null) {
  return confidence === null || source === "RULE" || source === "MANUAL" || source === "LLM"
    ? null
    : `${confidence} %`;
}

export function SourcePill({
  source,
  confidence = null,
  className,
}: {
  source: CategorizationSource;
  confidence?: number | null;
  className?: string;
}) {
  const Icon = SOURCE_ICON[source];
  const percent = confidenceText(source, confidence);
  return (
    <span
      data-slot="source-pill"
      className={cn(
        "bg-muted text-muted-foreground inline-flex h-6 shrink-0 items-center gap-1.5 rounded-full px-2 text-xs font-semibold whitespace-nowrap",
        className,
      )}
    >
      <Icon aria-hidden className="size-3.5" />
      <span>
        <span className="sr-only">{source === "MANUAL" ? "escolhida por " : "sugerida por "}</span>
        {SOURCE_LABEL[source]}
      </span>
      {percent ? (
        <span className="tabular font-mono">
          <span className="sr-only">, confiança de </span>
          {percent}
        </span>
      ) : null}
    </span>
  );
}
