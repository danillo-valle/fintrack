// O dinheiro de verdade no Início (M13.3a, ADR-025, prancha N-Inicio): "Na conta hoje" (só as
// contas correntes, e o que sobra depois das faturas do mês), "Guardado" (as poupanças, fora do
// "Na conta hoje") e "Faturas a pagar" (a fatura de cada cartão que vence agora). São os números do
// banco, como o app do banco mostra; cada um leva à conta ou à fatura.
import Link from "next/link";
import { CreditCard, Landmark, PiggyBank } from "lucide-react";
import type { HouseholdPerson } from "@fintrack/core";
import { AmountText } from "@/components/money/amount-text";
import { PersonAvatar } from "@/components/visual/person-avatar";
import { formatBRL } from "@/lib/money";
import { NUMBER_LINK, TEXT_LINK } from "@/lib/styles";
import { cn } from "@/lib/utils";
import type { BankHome } from "../server/queries";

const asOfTime = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo",
  hour: "2-digit",
  minute: "2-digit",
});
const monthName = new Intl.DateTimeFormat("pt-BR", { month: "long", timeZone: "UTC" });
const dm = (date: string) => `${date.slice(8, 10)}/${date.slice(5, 7)}`;

const SECTION =
  "bg-card flex min-w-0 flex-col gap-3 rounded-[1.25rem] border px-4 py-4 md:px-5 md:py-5";
const H2 = "text-[1.0625rem] font-extrabold tracking-[-0.01em] md:text-xl";
const BIG = "tabular font-mono text-[1.75rem] font-extrabold tracking-[-0.02em] md:text-[2.125rem]";

function Tile({ tone, children }: { tone: 1 | 3 | 5; children: React.ReactNode }) {
  return (
    <span
      aria-hidden
      style={
        {
          "--tone": `var(--chart-${tone})`,
          "--ink": `var(--chart-${tone}-ink)`,
        } as React.CSSProperties
      }
      className="grid size-9 shrink-0 place-items-center rounded-[0.625rem] bg-[color-mix(in_srgb,var(--tone)_16%,transparent)] text-[var(--ink)] [&_svg]:size-[1.125rem]"
    >
      {children}
    </span>
  );
}

/** As iniciais de quem usa os cartões da conta, uma sobre a outra. */
function Holders({ people }: { people: readonly HouseholdPerson[] }) {
  if (people.length === 0) return null;
  return (
    <span className="flex shrink-0 -space-x-1.5" title={people.map((p) => p.firstName).join(", ")}>
      {people.map((p) => (
        <PersonAvatar
          key={p.userId}
          initials={p.initials}
          tone={p.tone}
          size="sm"
          className="ring-card ring-2"
        />
      ))}
      <span className="sr-only">Quem usa: {people.map((p) => p.firstName).join(", ")}</span>
    </span>
  );
}

/** A hora em que o banco informou o saldo (a mais recente), ou "calculado" numa conta manual. */
function asOfNote(accounts: BankHome["checking"]): string {
  const asOf = accounts
    .map((a) => a.asOf)
    .filter((d): d is Date => d !== null)
    .sort((a, b) => b.getTime() - a.getTime())[0];
  return asOf ? `banco às ${asOfTime.format(asOf)}` : "saldo inicial mais os lançamentos";
}

/** "Na conta hoje" e "Guardado", lado a lado no computador. */
export function MoneyNow({ bank, aside }: { bank: BankHome; aside?: React.ReactNode }) {
  if (bank.checking.length === 0 && bank.savings.length === 0) return null;
  const month = monthName.format(new Date(`${bank.month}-15T12:00:00Z`));
  const only = bank.checking.length === 1 ? bank.checking[0] : null;
  return (
    <div className="grid items-stretch gap-4 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
      {bank.checking.length > 0 ? (
        <section aria-labelledby="na-conta-hoje" className={SECTION}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 id="na-conta-hoje" className={H2}>
              Na conta hoje
            </h2>
            {aside ?? (
              <span className="text-muted-foreground text-sm">{asOfNote(bank.checking)}</span>
            )}
          </div>
          <span className={BIG} data-testid="na-conta-total">
            {formatBRL(bank.inAccounts)}
          </span>
          <span className="text-muted-foreground text-sm">
            {only ? only.name : `Em ${bank.checking.length} contas`} · o que dá para gastar agora
          </span>
          {bank.toPay > 0n ? (
            <div className="flex flex-wrap items-baseline justify-between gap-2 border-t pt-3">
              <span className="text-sm">Depois das faturas de {month}</span>
              <span
                className="tabular font-mono text-lg font-bold"
                data-testid="depois-das-faturas"
              >
                {formatBRL(bank.afterBills)}
              </span>
            </div>
          ) : null}
          <ul className="flex flex-col">
            {bank.checking.map((a) => (
              <li key={a.id} className="flex items-center gap-3 border-t py-2.5">
                <Tile tone={5}>
                  <Landmark />
                </Tile>
                <span className="min-w-0 flex-1 truncate font-semibold">{a.name}</span>
                <Link
                  href={`/lancamentos?conta=${a.id}`}
                  className={cn(NUMBER_LINK, "tabular font-mono font-bold")}
                >
                  {formatBRL(a.balance.today)}
                  <span className="sr-only">, ver os lançamentos de {a.name}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {bank.savings.length > 0 ? (
        <section aria-labelledby="guardado" className={SECTION}>
          <div className="flex items-center gap-3">
            <Tile tone={3}>
              <PiggyBank />
            </Tile>
            <h2 id="guardado" className={H2}>
              Guardado
            </h2>
          </div>
          <span className={BIG} data-testid="guardado-total">
            {formatBRL(bank.saved)}
          </span>
          <span className="text-muted-foreground text-sm">
            {bank.savings.length === 1 ? bank.savings[0]?.name : `${bank.savings.length} poupanças`}{" "}
            · fora do “Na conta hoje”
          </span>
          {bank.savedChange !== 0n ? (
            <span className="text-sm">
              <AmountText cents={bank.savedChange} className="font-bold" /> em {month}
            </span>
          ) : null}
          <ul className="flex flex-col">
            {bank.savings.map((a) => (
              <li key={a.id} className="flex items-center justify-between gap-3 border-t py-2.5">
                <span className="min-w-0 truncate font-semibold">{a.name}</span>
                <Link
                  href={`/lancamentos?conta=${a.id}`}
                  className={cn(NUMBER_LINK, "tabular font-mono font-bold")}
                >
                  {formatBRL(a.balance.today)}
                  <span className="sr-only">, ver a poupança {a.name}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

/** "Faturas a pagar": a fatura de cada cartão que vence agora, e o total das que vencem no mês. */
export function BillsToPay({ bank, aside }: { bank: BankHome; aside?: React.ReactNode }) {
  if (bank.cards.length === 0) return null;
  const month = monthName.format(new Date(`${bank.month}-15T12:00:00Z`));
  return (
    <section aria-labelledby="faturas-a-pagar" className={SECTION}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="faturas-a-pagar" className={H2}>
          Faturas a pagar
        </h2>
        {aside ?? (
          <span className="text-muted-foreground text-sm">a de cada cartão, até agora</span>
        )}
      </div>
      <ul className="flex flex-col">
        {bank.cards.map((c) => {
          const title = c.lastFour ? `${c.name} final ${c.lastFour}` : c.name;
          return (
            <li key={c.id} className="flex items-center gap-3 border-t py-3">
              <Tile tone={1}>
                <CreditCard />
              </Tile>
              <span className="flex min-w-0 flex-1 flex-col">
                <strong className="truncate">{c.name}</strong>
                <span className="text-muted-foreground tabular truncate font-mono text-xs">
                  {[
                    c.lastFour ? `···· ${c.lastFour}` : null,
                    c.bill
                      ? c.bill.state === "paid"
                        ? `paga · venceu ${dm(c.bill.dueDate)}`
                        : `vence ${dm(c.bill.dueDate)}`
                      : "nenhuma compra ainda",
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </span>
              <Holders people={c.holders} />
              <Link
                href={`/cartoes?conta=${c.id}${c.bill ? `&fatura=${c.bill.id}` : ""}`}
                className={cn(NUMBER_LINK, "tabular font-mono text-base font-extrabold")}
              >
                {formatBRL(c.bill?.amount ?? 0n)}
                <span className="sr-only">, ver a fatura de {title}</span>
              </Link>
            </li>
          );
        })}
      </ul>
      <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3">
        <span className="text-muted-foreground text-sm">Vencem em {month}, sem as já pagas</span>
        <span className="tabular font-mono text-lg font-extrabold" data-testid="cartoes-total">
          {formatBRL(bank.toPay)}
        </span>
      </div>
      <Link href="/cartoes" className={cn(TEXT_LINK, "self-start text-sm")}>
        Abrir Cartões
      </Link>
    </section>
  );
}
