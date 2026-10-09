import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { formatBRL } from "@/lib/money";
import { cn } from "@/lib/utils";

type Props = {
  /** Valor em centavos. Positivo = receita, negativo = despesa. */
  cents: bigint;
  className?: string;
  /** "inherit": usa a cor do texto em volta (sobre o cartão azul do saldo, por exemplo). */
  tone?: "semantic" | "inherit";
  /** false: sem a seta (quando a seta já está em volta, como no StatCard). O sinal e o texto do
   * leitor de tela continuam. */
  arrow?: boolean;
};

// Mostra um valor com sinal, cor e ícone, em Geist Mono (colunas de dinheiro alinhadas).
// Cor nunca é o único sinal: quem não distingue verde de vermelho vê a seta e o sinal,
// e quem usa leitor de tela ouve "Receita de" ou "Despesa de".
export function AmountText({ cents, className, tone = "semantic", arrow = true }: Props) {
  const kind = cents > 0n ? "income" : cents < 0n ? "expense" : "zero";
  const absolute = cents < 0n ? -cents : cents;

  return (
    <span
      className={cn(
        "tabular inline-flex items-center gap-1 font-mono font-medium whitespace-nowrap",
        tone === "semantic" && kind === "income" && "text-income",
        tone === "semantic" && kind === "expense" && "text-expense",
        className,
      )}
    >
      {arrow && kind === "income" ? <ArrowUpRight aria-hidden className="size-4" /> : null}
      {arrow && kind === "expense" ? <ArrowDownRight aria-hidden className="size-4" /> : null}
      {kind !== "zero" ? (
        <span className="sr-only">{kind === "income" ? "Receita de" : "Despesa de"}</span>
      ) : null}
      <span aria-hidden>{kind === "income" ? "+" : kind === "expense" ? "−" : ""}</span>
      {formatBRL(absolute)}
    </span>
  );
}
