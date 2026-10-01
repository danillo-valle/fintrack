import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { formatBRL } from "@/lib/money";
import { cn } from "@/lib/utils";

type Props = {
  /** Valor em centavos. Positivo = receita, negativo = despesa. */
  cents: bigint;
  className?: string;
};

// Mostra um valor com sinal, cor e ícone.
// Cor nunca é o único sinal: quem não distingue verde de vermelho vê a seta e o sinal,
// e quem usa leitor de tela ouve "Receita de" ou "Despesa de".
export function AmountText({ cents, className }: Props) {
  const kind = cents > 0n ? "income" : cents < 0n ? "expense" : "zero";
  const absolute = cents < 0n ? -cents : cents;

  return (
    <span
      className={cn(
        "tabular inline-flex items-center gap-1 font-medium whitespace-nowrap",
        kind === "income" && "text-income",
        kind === "expense" && "text-expense",
        className,
      )}
    >
      {kind === "income" ? <ArrowUpRight aria-hidden className="size-4" /> : null}
      {kind === "expense" ? <ArrowDownRight aria-hidden className="size-4" /> : null}
      {kind !== "zero" ? (
        <span className="sr-only">{kind === "income" ? "Receita de" : "Despesa de"}</span>
      ) : null}
      <span aria-hidden>{kind === "income" ? "+" : kind === "expense" ? "−" : ""}</span>
      {formatBRL(absolute)}
    </span>
  );
}
