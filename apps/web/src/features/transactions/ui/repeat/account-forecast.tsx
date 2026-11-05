// Uma conta olhando para a frente (M13.3c, ADR-027; pranchas O-ContaPrevista e O-CelReceita): em
// cada mês do período de hoje em diante, o que entra e o que sai pelas previstas e as faturas que
// esta conta paga; no mês de hoje, o que chegou das recorrências do banco e quanto veio diferente.
// Nada aqui é lançamento: a lista de verdade continua embaixo, com o saldo.
import Link from "next/link";
import { ArrowLeftRight } from "lucide-react";
import { StatCard, SummaryGrid } from "@/components/visual/summary";
import { ToneChip } from "@/components/visual/tone-chip";
import { civilDayMonth } from "@/lib/dates";
import { formatBRL } from "@/lib/money";
import { NUMBER_LINK } from "@/lib/styles";
import { cn } from "@/lib/utils";
import { monthName } from "../../presentation";
import type { AccountForecastView } from "../../server/queries";
import { ForecastList } from "./forecast-list";

/** "+ R$ 9.940,00", "− R$ 212,48" ou, sem nada, "R$ 0,00" (o sinal escrito, não só a cor). */
const signed = (cents: bigint) =>
  cents === 0n
    ? formatBRL(0n)
    : `${cents < 0n ? "−" : "+"} ${formatBRL(cents < 0n ? -cents : cents)}`;

export function AccountForecast({ forecast }: { forecast: AccountForecastView }) {
  const shown = forecast.months.filter((m) => m.items.length > 0 || m.bills.length > 0);
  if (shown.length === 0 && forecast.arrivals.length === 0) return null;
  return (
    <div className="flex flex-col gap-4">
      {shown.map((m) => {
        const income = m.items.filter((i) => i.amount > 0n).reduce((t, i) => t + i.amount, 0n);
        const out = m.items.filter((i) => i.amount < 0n).reduce((t, i) => t - i.amount, 0n);
        const bills = m.bills.reduce((t, b) => t + b.known + b.forecast, 0n);
        const name = monthName(m.month);
        const id = `previsto-${m.month}`;
        return (
          <section
            key={m.month}
            aria-labelledby={id}
            data-testid="conta-prevista"
            className="bg-card flex flex-col gap-3 rounded-[1.25rem] border p-4 md:p-5"
          >
            <h2 id={id} className="text-[1.0625rem] font-extrabold md:text-xl">
              {m.current ? `${name}: o que ainda vem` : `${name}, previsto`}
            </h2>
            <SummaryGrid label={`${name}, previsto`} className="md:grid-cols-3">
              <StatCard label="Entradas previstas" note="o que se repete" tone="income">
                <span className="tabular font-mono">{signed(income)}</span>
              </StatCard>
              <StatCard label="Saídas previstas" note="as fixas da conta" tone="expense">
                <span className="tabular font-mono">{signed(-out)}</span>
              </StatCard>
              <StatCard label="Faturas a pagar" note="o que já se sabe delas">
                <span className="tabular font-mono">{formatBRL(bills)}</span>
              </StatCard>
            </SummaryGrid>
            {m.items.length > 0 ? (
              <ForecastList rows={m.items} label={`Previstas de ${name.toLowerCase()}`} />
            ) : null}
            {m.bills.length > 0 ? (
              <ul aria-label="Faturas que esta conta paga" className="flex flex-col gap-2">
                {m.bills.map((b) => (
                  <li
                    key={b.cardAccountId}
                    className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 rounded-[0.875rem] border-[1.5px] border-dashed px-3 py-2.5"
                  >
                    <div className="min-w-0">
                      <Link
                        href={`/cartoes?conta=${b.cardAccountId}`}
                        className={cn(NUMBER_LINK, "font-bold")}
                      >
                        Fatura {b.cardName}
                      </Link>
                      <p className="text-muted-foreground text-[0.8125rem]">
                        vence {civilDayMonth(b.dueDate)} ·{" "}
                        {b.forecast > 0n
                          ? `${formatBRL(b.known)} já chegou e ${formatBRL(b.forecast)} previstos`
                          : "o que já chegou"}
                      </p>
                    </div>
                    <span className="text-muted-foreground tabular font-mono font-bold">
                      − {formatBRL(b.known + b.forecast)}
                    </span>
                    <span className="col-span-2">
                      <ToneChip tone={1} icon={ArrowLeftRight}>
                        Pagamento de fatura: fora das saídas
                      </ToneChip>
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
            {m.current ? null : (
              <p className="text-muted-foreground text-[0.8125rem]">
                {name} ainda não começou: aqui só o que se repete. As variáveis entram quando
                acontecerem.
              </p>
            )}
          </section>
        );
      })}
      {forecast.arrivals.length > 0 ? (
        <section
          aria-labelledby="previsto-e-chegou"
          className="bg-card flex flex-col gap-2 rounded-[1.25rem] border p-4 md:p-5"
        >
          <h2 id="previsto-e-chegou" className="text-[1.0625rem] font-extrabold md:text-xl">
            O previsto e o que chegou
          </h2>
          <ul className="divide-y">
            {forecast.arrivals.map((a) => {
              const diff = a.amount - a.expected;
              // Na saída, chegar "a mais" é pagar mais: compara pelo tamanho, não pelo sinal
              const bigger =
                (a.amount < 0n ? -a.amount : a.amount) >
                (a.expected < 0n ? -a.expected : a.expected);
              const by = diff < 0n ? -diff : diff;
              return (
                <li key={a.transactionId} className="flex flex-col gap-0.5 py-2.5">
                  <div className="flex justify-between gap-3">
                    <Link
                      href={`/lancamentos/${a.transactionId}`}
                      className={cn(NUMBER_LINK, "font-bold")}
                    >
                      {a.title}
                    </Link>
                    <span className="tabular font-mono font-bold">{signed(a.amount)}</span>
                  </div>
                  <span className="text-muted-foreground text-[0.8125rem]">
                    {civilDayMonth(a.occurredOn)} · Previsto{" "}
                    {formatBRL(a.expected < 0n ? -a.expected : a.expected)} · chegou {formatBRL(by)}{" "}
                    {bigger ? "a mais" : "a menos"}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
