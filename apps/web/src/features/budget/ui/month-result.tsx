// O resultado do mês no Início (M13.3a, ADR-025, prancha N-Inicio): as entradas nas contas, as
// saídas (o que saiu das contas mais as faturas que vencem no mês) e o que sobra. Cada compra conta
// uma vez: no cartão, no mês em que a fatura vence. Pagamento de fatura e transferências entre as
// contas (como a poupança) não entram: não são gasto nem receita. Os dois números levam à lista,
// que mostra as contas e os cartões separados, com o mesmo total.
import { MoneyLink } from "@/components/money/money-link";
import { AmountText } from "@/components/money/amount-text";
import { formatBRL } from "@/lib/money";
import type { Linked } from "../server/queries";

export function MonthResult({
  monthLabel,
  elapsedDays,
  result,
  received,
}: {
  /** "novembro" */
  monthLabel: string;
  elapsedDays: number;
  result: { income: Linked; expense: Linked; accounts: bigint; cards: bigint; net: bigint };
  /** Quantos recebidos do banco ainda esperam revisão (ficam fora) */
  received: number;
}) {
  return (
    <section
      aria-labelledby="resultado-do-mes"
      className="bg-card flex flex-col gap-4 rounded-[1.25rem] border px-4 py-4 md:px-5 md:py-5"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2
          id="resultado-do-mes"
          className="text-[1.0625rem] font-extrabold tracking-[-0.01em] md:text-xl"
        >
          Resultado de {monthLabel}
        </h2>
        <span className="text-muted-foreground text-sm">
          até hoje, dia {elapsedDays} · com o que vence no mês
        </span>
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        <div className="flex min-w-0 flex-col gap-0.5" data-testid="resultado-entradas">
          <span className="text-muted-foreground text-sm">Entradas</span>
          <MoneyLink
            cents={result.income.cents}
            href={result.income.href}
            label={`Entradas de ${monthLabel} até hoje`}
            sign="+"
            className="text-income text-[1.375rem] font-extrabold md:text-2xl"
          />
          <span className="text-muted-foreground text-xs">
            salário e outras entradas nas contas
          </span>
        </div>
        <div className="flex min-w-0 flex-col gap-0.5" data-testid="resultado-saidas">
          <span className="text-muted-foreground text-sm">Saídas</span>
          <MoneyLink
            cents={result.expense.cents}
            href={result.expense.href}
            label={`Saídas de ${monthLabel} até hoje`}
            sign="−"
            className="text-expense text-[1.375rem] font-extrabold md:text-2xl"
          />
          <span className="text-muted-foreground text-xs">
            débito e Pix {formatBRL(result.accounts)} · faturas que vencem em {monthLabel}{" "}
            {formatBRL(result.cards)}
          </span>
        </div>
        <div className="flex min-w-0 flex-col gap-0.5" data-testid="resultado-sobra">
          <span className="text-muted-foreground text-sm">Sobra</span>
          <AmountText cents={result.net} className="text-[1.375rem] font-extrabold md:text-2xl" />
          <span className="text-muted-foreground text-xs">entradas menos saídas</span>
        </div>
      </div>
      <p className="text-muted-foreground border-t pt-3 text-[0.8125rem]">
        Cada compra conta <strong>uma vez</strong>: no cartão, no mês em que a fatura vence. O
        pagamento da fatura e as transferências entre as suas contas (como a poupança) não entram,
        porque não são gasto nem receita.
        {received > 0
          ? ` ${received === 1 ? "1 recebido do banco ainda espera" : `${received} recebidos do banco ainda esperam`} revisão e fica de fora até lá.`
          : ""}
      </p>
    </section>
  );
}
