import { ArrowDownRight, ArrowUpRight, Landmark, Wallet } from "lucide-react";
import type { Balance } from "@fintrack/core";
import { AmountText } from "@/components/money/amount-text";
import { StatCard, SummaryGrid } from "@/components/visual/summary";
import { dayAndTime } from "@/lib/dates";
import type { Totals } from "./totals-summary";

// O resumo de uma conta em Lançamentos (M13.3a, prancha N-Lancamentos): o saldo no começo do
// período, as entradas, as saídas e o saldo de hoje. As entradas e as saídas são as da lista (o
// mesmo WHERE); transferências e pagamentos de fatura aparecem na lista, mas ficam fora delas. O
// saldo conta tudo o que se mexeu na conta (accountBalance do core): numa conta ligada, o do banco.
export function AccountSummary({
  balance,
  totals,
  startLabel,
  asOf,
}: {
  balance: Balance;
  totals: Totals;
  /** "Saldo em 1º de novembro" */
  startLabel: string;
  /** Quando o banco informou o saldo (conta ligada) */
  asOf: Date | null;
}) {
  const bank = asOf ? dayAndTime(asOf) : null;
  return (
    <SummaryGrid label="Resumo da conta" className="md:grid-cols-4">
      <StatCard label={startLabel} icon={<Landmark />} data-testid="conta-saldo-inicio">
        <AmountText cents={balance.atStart} arrow={false} tone="inherit" className="font-bold" />
      </StatCard>
      <StatCard label="Entradas" tone="income" icon={<ArrowUpRight />} data-testid="total-entradas">
        <AmountText cents={totals.income} arrow={false} className="font-bold" />
      </StatCard>
      <StatCard
        label="Saídas"
        tone="expense"
        icon={<ArrowDownRight />}
        note="débito, Pix e boletos"
        data-testid="total-saidas"
      >
        <AmountText cents={totals.expense} arrow={false} className="font-bold" />
      </StatCard>
      <StatCard
        label="Saldo hoje"
        icon={<Wallet />}
        note={bank ? `banco às ${bank.time}` : "saldo inicial mais os lançamentos"}
        data-testid="conta-saldo-hoje"
      >
        <AmountText cents={balance.today} arrow={false} tone="inherit" className="font-bold" />
      </StatCard>
    </SummaryGrid>
  );
}
