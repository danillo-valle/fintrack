import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { AmountText } from "@/components/money/amount-text";
import { HighlightCard, StatCard, SummaryGrid } from "@/components/visual/summary";

export type Totals = { net: bigint; income: bigint; expense: bigint };

// Saldo, entradas e saídas de um conjunto de lançamentos: os totais do filtro em Lançamentos e
// os do mês no Início. Os números vêm do banco, com o MESMO filtro da lista (sumTransactions).
// Entradas em verde e saídas em vermelho, sempre com sinal e com o texto do leitor de tela.
export function TotalsSummary({
  totals,
  label,
  balanceLabel,
  testIdPrefix,
  className,
}: {
  totals: Totals;
  /** Nome da região: "Totais do filtro", "Resumo do mês" */
  label: string;
  /** Rótulo do saldo: "Saldo do período", "Saldo de outubro de 2026" */
  balanceLabel: string;
  /** Prefixo dos data-testid: "total" vira total-saldo, total-entradas e total-saidas */
  testIdPrefix: string;
  className?: string;
}) {
  return (
    <SummaryGrid label={label} className={className}>
      <HighlightCard label={balanceLabel} data-testid={`${testIdPrefix}-saldo`}>
        <AmountText cents={totals.net} tone="inherit" arrow={false} className="font-bold" />
      </HighlightCard>
      <StatCard
        label="Entradas"
        tone="income"
        icon={<ArrowUpRight />}
        data-testid={`${testIdPrefix}-entradas`}
      >
        <AmountText cents={totals.income} arrow={false} className="font-bold" />
      </StatCard>
      <StatCard
        label="Saídas"
        tone="expense"
        icon={<ArrowDownRight />}
        data-testid={`${testIdPrefix}-saidas`}
      >
        <AmountText cents={totals.expense} arrow={false} className="font-bold" />
      </StatCard>
    </SummaryGrid>
  );
}
