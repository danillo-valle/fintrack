import Link from "next/link";
import { formatBRL } from "@/lib/money";
import { NUMBER_LINK } from "@/lib/styles";
import { cn } from "@/lib/utils";

// Um valor que leva aos lançamentos que o compõem (M08: "nenhum número sem caminho").
// Sublinhado pontilhado (NUMBER_LINK), Geist Mono e algarismos alinhados. O nome do link diz o
// que é o número e para onde vai ("Mercado, gasto até hoje: R$ 482,35. Ver os lançamentos").
export function MoneyLink({
  cents,
  href,
  label,
  sign,
  goes = "Ver os lançamentos",
  className,
  "data-testid": testId,
}: {
  cents: bigint;
  href: string;
  /** O que é o número, para o leitor de tela: "Mercado, gasto até hoje" */
  label: string;
  /** Sinal escrito na frente ("+" para entrada, "−" para saída); sem sinal por padrão */
  sign?: "+" | "−";
  /** Para onde o link leva, dito no fim do nome (o fluxo leva ao detalhe do mês, não à lista) */
  goes?: string;
  className?: string;
  "data-testid"?: string;
}) {
  const text = `${sign ? `${sign} ` : ""}${formatBRL(cents < 0n ? -cents : cents)}`;
  return (
    <Link
      href={href}
      data-testid={testId}
      data-cents={cents.toString()}
      aria-label={`${label}: ${text}. ${goes}`}
      // inline-flex e 24 px de altura: a área de toque mínima da WCAG 2.5.8 mesmo quando dois
      // valores ficam um embaixo do outro (gasto e previsto), sem mudar o texto
      className={cn(
        "tabular inline-flex min-h-6 items-center font-mono whitespace-nowrap",
        NUMBER_LINK,
        className,
      )}
    >
      {text}
    </Link>
  );
}
