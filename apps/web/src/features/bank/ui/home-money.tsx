// O dinheiro do banco no Início (M13.2, canvas linha M, prancha M-Inicio), separado como na página
// inicial do banco: "Na conta hoje" (o total das contas e cada conta) e "Seus cartões" (a fatura
// aberta, com o fechamento e o vencimento DELA, o limite disponível e quem usa). Cada número leva
// à lista que o compõe: a conta, aos lançamentos dela; o cartão, à página da fatura.
import Link from "next/link";
import { CreditCard, Landmark } from "lucide-react";
import type { HouseholdPerson } from "@fintrack/core";
import { Meter, usedPercentLabel } from "@/components/visual/meter";
import { PersonAvatar } from "@/components/visual/person-avatar";
import { formatBRL } from "@/lib/money";
import { NUMBER_LINK } from "@/lib/styles";
import { cn } from "@/lib/utils";
import type { BankHome } from "../server/queries";

const asOfTime = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo",
  hour: "2-digit",
  minute: "2-digit",
});
const monthName = new Intl.DateTimeFormat("pt-BR", { month: "long", timeZone: "UTC" });
const dm = (date: string) => `${date.slice(8, 10)}/${date.slice(5, 7)}`;

const SECTION = "bg-card flex flex-col gap-3 rounded-[1.25rem] border px-4 py-4 md:px-5 md:py-5";
const H2 = "text-[1.0625rem] font-extrabold tracking-[-0.01em] md:text-xl";

function Tile({ tone, children }: { tone: 1 | 5; children: React.ReactNode }) {
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

/** "Na conta hoje": o total no alto e cada conta embaixo, com o saldo que o banco informou. */
export function AccountsToday({
  accounts,
  aside,
}: {
  accounts: BankHome["accounts"];
  /** A linha da busca (SyncLine) no canto do título */
  aside?: React.ReactNode;
}) {
  if (accounts.length === 0) return null;
  const known = accounts.filter((a) => a.balance !== null);
  const total = known.reduce((sum, a) => sum + (a.balance ?? 0n), 0n);
  const asOf = known
    .map((a) => a.asOf)
    .filter((d): d is Date => d !== null)
    .sort((a, b) => b.getTime() - a.getTime())[0];
  return (
    <section aria-labelledby="na-conta-hoje" className={SECTION}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="na-conta-hoje" className={H2}>
          Na conta hoje
        </h2>
        {aside}
      </div>
      <div className="flex flex-col gap-0.5">
        <span className="text-muted-foreground text-sm">
          {accounts.length === 1 ? "Em 1 conta" : `Total em ${accounts.length} contas`}
        </span>
        <span
          className="tabular font-mono text-[1.75rem] font-extrabold tracking-[-0.02em] md:text-[2.25rem]"
          data-testid="na-conta-total"
        >
          {formatBRL(total)}
        </span>
        <span className="text-muted-foreground text-xs">
          {asOf ? `informado pelo banco às ${asOfTime.format(asOf)}` : "ainda sem busca"}
          {known.length < accounts.length ? " · alguma conta ainda sem saldo do banco" : ""}
        </span>
      </div>
      <ul className="flex flex-col">
        {accounts.map((a) => (
          <li key={a.id} className="flex items-center gap-3 border-t py-3">
            <Tile tone={5}>
              <Landmark />
            </Tile>
            <span className="flex min-w-0 flex-1 flex-col">
              <strong className="truncate">{a.name}</strong>
              <span className="text-muted-foreground truncate text-xs">
                ambiente {a.wallet.name}
              </span>
            </span>
            <Link
              href={`/lancamentos?conta=${a.id}`}
              className={cn(
                NUMBER_LINK,
                "tabular font-mono text-[0.9375rem] font-bold md:text-base",
              )}
            >
              {a.balance !== null ? formatBRL(a.balance) : "—"}
              <span className="sr-only">, ver os lançamentos de {a.name}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

type CardRow = BankHome["cards"][number];

function Limit({ card }: { card: CardRow }) {
  const { creditLimit: limit, availableCredit: available } = card;
  if (limit === null || available === null) {
    return <span className="text-muted-foreground text-xs">sem limite informado</span>;
  }
  const used = limit - available;
  return (
    <span className="flex min-w-0 flex-col gap-1">
      <span className="flex items-baseline justify-between gap-2 text-[0.8125rem]">
        <span className="tabular font-mono font-bold">{formatBRL(available)}</span>
        <span className="text-muted-foreground tabular font-mono">de {formatBRL(limit)}</span>
      </span>
      <Meter
        used={used}
        total={limit}
        label={`Limite usado: ${usedPercentLabel(used, limit)}. Disponível ${formatBRL(available)} de ${formatBRL(limit)}.`}
      />
    </span>
  );
}

function OpenTotal({ card, title }: { card: CardRow; title: string }) {
  return (
    <Link
      href={`/carteiras/conta/${card.id}`}
      className={cn(NUMBER_LINK, "text-expense tabular font-mono text-base font-extrabold")}
    >
      {formatBRL(card.open?.total ?? 0n)}
      <span className="sr-only">, ver a fatura de {title}</span>
    </Link>
  );
}

function Dates({ card }: { card: CardRow }) {
  return card.open ? (
    <>
      <span className="tabular font-mono font-bold">{dm(card.open.dueDate)}</span>
      <span className="text-muted-foreground text-xs">fecha {dm(card.open.closingDate)}</span>
    </>
  ) : (
    <Link
      href={`/ajustes/contas/${card.id}`}
      className={cn(NUMBER_LINK, "text-muted-foreground text-xs")}
    >
      cadastre o fechamento
    </Link>
  );
}

/** O rodapé: a soma das faturas abertas, com o mês do vencimento quando todas vencem no mesmo. */
function dueTotalLabel(cards: readonly CardRow[]): string {
  const months = new Set(cards.flatMap((c) => (c.open ? [c.open.dueDate.slice(0, 7)] : [])));
  const [only] = [...months];
  if (months.size === 1 && only) {
    const month = monthName.format(new Date(`${only}-01T00:00:00Z`));
    return cards.length === 1
      ? `Vence em ${month}`
      : `Vence em ${month}, nas ${cards.length} faturas`;
  }
  return "Total das faturas abertas";
}

/** "Seus cartões": uma linha por cartão; no celular, um bloco por cartão. */
export function CardsSummary({
  cards,
  aside,
}: {
  cards: BankHome["cards"];
  aside?: React.ReactNode;
}) {
  if (cards.length === 0) return null;
  const total = cards.reduce((sum, c) => sum + (c.open?.total ?? 0n), 0n);
  const titleOf = (c: CardRow) => (c.lastFour ? `${c.name} final ${c.lastFour}` : c.name);
  const detailOf = (c: CardRow) =>
    [
      c.lastFour ? `···· ${c.lastFour}` : null,
      c.additionalCount === 1
        ? "inclui 1 adicional"
        : c.additionalCount > 1
          ? `inclui ${c.additionalCount} adicionais`
          : null,
    ]
      .filter(Boolean)
      .join(" · ");
  return (
    <section aria-labelledby="seus-cartoes" className={SECTION}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="seus-cartoes" className={H2}>
          Seus cartões
        </h2>
        {aside ?? <span className="text-muted-foreground text-sm">fatura aberta até agora</span>}
      </div>

      {/* Computador: a tabela, como a do banco */}
      <table className="hidden w-full border-collapse md:table">
        <thead>
          <tr className="text-muted-foreground text-left text-xs font-bold tracking-[0.04em] uppercase">
            <th scope="col" className="pb-2 font-bold">
              Cartão
            </th>
            <th scope="col" className="px-3 pb-2 font-bold">
              Vence
            </th>
            <th scope="col" className="px-3 pb-2 text-right font-bold">
              Fatura aberta
            </th>
            <th scope="col" className="w-56 pb-2 pl-3 font-bold">
              Limite disponível
            </th>
          </tr>
        </thead>
        <tbody>
          {cards.map((c) => (
            <tr key={c.id} className="border-t">
              <th scope="row" className="py-3 text-left font-normal">
                <span className="flex items-center gap-3">
                  <Tile tone={1}>
                    <CreditCard />
                  </Tile>
                  <span className="flex min-w-0 flex-col">
                    <strong className="truncate">{c.name}</strong>
                    <span className="text-muted-foreground tabular truncate font-mono text-xs">
                      {detailOf(c)}
                    </span>
                  </span>
                  <Holders people={c.holders} />
                </span>
              </th>
              <td className="px-3 py-3">
                <span className="flex flex-col">
                  <Dates card={c} />
                </span>
              </td>
              <td className="px-3 py-3 text-right">
                <OpenTotal card={c} title={titleOf(c)} />
              </td>
              <td className="py-3 pl-3">
                <Limit card={c} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Celular: um bloco por cartão */}
      <ul className="flex flex-col md:hidden">
        {cards.map((c) => (
          <li key={c.id} className="flex flex-col gap-2 border-t py-3">
            <span className="flex items-center gap-3">
              <Tile tone={1}>
                <CreditCard />
              </Tile>
              <span className="flex min-w-0 flex-1 flex-col">
                <strong className="truncate">{c.name}</strong>
                <span className="text-muted-foreground tabular truncate font-mono text-xs">
                  {c.open
                    ? `vence ${dm(c.open.dueDate)} · fecha ${dm(c.open.closingDate)}`
                    : detailOf(c)}
                </span>
              </span>
              <OpenTotal card={c} title={titleOf(c)} />
            </span>
            {c.open ? null : (
              <span className="text-xs">
                <Dates card={c} />
              </span>
            )}
            <Limit card={c} />
          </li>
        ))}
      </ul>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3">
        <span className="text-muted-foreground text-sm">{dueTotalLabel(cards)}</span>
        <span className="tabular font-mono text-lg font-extrabold" data-testid="cartoes-total">
          {formatBRL(total)}
        </span>
      </div>
    </section>
  );
}
