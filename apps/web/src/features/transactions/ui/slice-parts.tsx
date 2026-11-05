// O recorte de um número do painel em duas partes (M13.3a, pranchas N-DoPainel e N-CelDoPainel):
// "Nas contas" e "Nos cartões", cada uma com o seu total, e os cartões por fatura. Débito e cartão
// nunca na mesma lista (o pedido de 03/11), e a soma das duas partes é o número clicado: as duas
// usam o mesmo filtro, com o lado escolhido (ADR-025).
import Link from "next/link";
import type { CivilDate } from "@fintrack/core";
import { AmountText } from "@/components/money/amount-text";
import { StatCard, SummaryGrid } from "@/components/visual/summary";
import { formatBRL } from "@/lib/money";
import { TEXT_LINK } from "@/lib/styles";
import type { PayerOption } from "../payers";
import type { ListPart } from "../server/queries";
import { TransactionList } from "./transaction-list";
import { civilDayMonth } from "@/lib/dates";

/** O total de uma parte: as saídas, ou as entradas quando a parte só tem entradas. */
const partTotal = (part: ListPart) => part.totals.net;

export function SliceSummary({
  title,
  accounts,
  cards,
}: {
  /** "Mercado · 01/11 a 03/11" */
  title: string;
  accounts: ListPart;
  cards: ListPart;
}) {
  return (
    <SummaryGrid
      label="Total do recorte"
      className="md:grid-cols-[minmax(0,1.4fr)_repeat(2,minmax(0,1fr))]"
    >
      <StatCard label={title} data-testid="recorte-total">
        <AmountText cents={partTotal(accounts) + partTotal(cards)} className="font-bold" />
      </StatCard>
      <StatCard label="Nas contas" note="débito, Pix e boletos" data-testid="recorte-contas">
        <AmountText cents={partTotal(accounts)} className="font-bold" />
      </StatCard>
      <StatCard
        label="Nos cartões"
        note="faturas que vencem no período"
        data-testid="recorte-cartoes"
      >
        <AmountText cents={partTotal(cards)} className="font-bold" />
      </StatCard>
    </SummaryGrid>
  );
}

function PartSection({
  id,
  title,
  description,
  part,
  more,
  children,
}: {
  id: string;
  title: string;
  description: string;
  part: ListPart;
  more: string | null;
  children: React.ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end justify-between gap-2 px-1">
        <div>
          <h2 id={id} className="text-xl font-extrabold tracking-[-0.01em]">
            {title}
          </h2>
          <p className="text-muted-foreground text-sm">{description}</p>
        </div>
        <AmountText cents={partTotal(part)} className="text-lg font-extrabold" />
      </div>
      {part.items.length === 0 ? (
        <p className="text-muted-foreground bg-card rounded-[1.125rem] border p-4 text-sm">
          Nada aqui neste recorte.
        </p>
      ) : (
        children
      )}
      {more ? (
        <Link href={more} className={TEXT_LINK}>
          Ver mais antigos
        </Link>
      ) : null}
    </section>
  );
}

export function SliceParts({
  accounts,
  cards,
  payers,
  today,
  moreAccounts,
  moreCards,
}: {
  accounts: ListPart;
  cards: ListPart;
  payers: readonly PayerOption[];
  today: CivilDate;
  /** A próxima página de cada parte (o cursor de cada uma vai num parâmetro próprio) */
  moreAccounts: string | null;
  moreCards: string | null;
}) {
  // Os cartões por fatura (a conta do cartão e o vencimento), na ordem em que aparecem
  const bills: { key: string; title: string; items: ListPart["items"] }[] = [];
  for (const item of cards.items) {
    const due = item.statement?.dueDate ?? item.cashOn;
    const key = `${item.account.id}:${due}`;
    const last = bills.find((b) => b.key === key);
    if (last) last.items.push(item);
    else
      bills.push({
        key,
        title: `${item.account.name} · fatura que vence em ${civilDayMonth(due)}`,
        items: [item],
      });
  }
  return (
    <div className="flex flex-col gap-8">
      <PartSection
        id="parte-contas"
        title="Nas contas"
        description="O que passou pelas contas: débito, Pix, boletos"
        part={accounts}
        more={moreAccounts}
      >
        <TransactionList items={accounts.items} payers={payers} today={today} dayHeading="h3" />
      </PartSection>
      <PartSection
        id="parte-cartoes"
        title="Nos cartões"
        description="Por fatura, no mês em que ela vence"
        part={cards}
        more={moreCards}
      >
        <div className="flex flex-col gap-6">
          {bills.map((bill) => {
            const total = bill.items.reduce((sum, item) => sum - item.amount, 0n);
            return (
              <section key={bill.key} aria-label={bill.title} className="flex flex-col gap-2">
                <h3 className="flex flex-wrap justify-between gap-2 px-1 text-[0.9375rem] font-bold">
                  <span>{bill.title}</span>
                  <span className="tabular font-mono">{formatBRL(total)}</span>
                </h3>
                <TransactionList items={bill.items} payers={payers} today={today} dayHeading="h4" />
              </section>
            );
          })}
        </div>
      </PartSection>
    </div>
  );
}
