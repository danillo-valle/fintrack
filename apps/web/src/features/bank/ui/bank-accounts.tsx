// "Contas e cartões" no Início (M09.1, prancha E-Inicio): o saldo da conta corrente e a fatura
// aberta de cada cartão, como o banco informa, com fechamento, vencimento e o limite usado.
// O cartão leva à página dele (fatura aberta e fechadas); a conta, à lista dos lançamentos dela.
import Link from "next/link";
import { CreditCard, Landmark } from "lucide-react";
import { Meter, usedPercentLabel } from "@/components/visual/meter";
import { formatBRL } from "@/lib/money";
import { NUMBER_LINK } from "@/lib/styles";
import { cn } from "@/lib/utils";

export type BankAccountCard = {
  id: string;
  name: string;
  kind: "CHECKING" | "SAVINGS" | "CREDIT_CARD" | "MEAL_VOUCHER" | "CASH";
  institution: string | null;
  wallet: { name: string; kind: "PERSONAL" | "SHARED" };
  lastFour: string | null;
  sharedPurchases: boolean;
  balance: {
    balance: bigint | null;
    creditLimit: bigint | null;
    availableCredit: bigint | null;
    closeDate: string | null;
    dueDate: string | null;
    asOf: Date;
  } | null;
  /** Fatura aberta (só cartão): a soma das compras recebidas */
  openTotal?: bigint | null;
};

const dm = (date: string | null) => (date ? `${date.slice(8, 10)}/${date.slice(5, 7)}` : "—");
const asOfTime = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo",
  hour: "2-digit",
  minute: "2-digit",
});

function Tile({ tone, children }: { tone: 1 | 4 | 5; children: React.ReactNode }) {
  return (
    <span
      aria-hidden
      style={
        {
          "--tone": `var(--chart-${tone})`,
          "--ink": `var(--chart-${tone}-ink)`,
        } as React.CSSProperties
      }
      className="grid size-[2.125rem] shrink-0 place-items-center rounded-[0.625rem] bg-[color-mix(in_srgb,var(--tone)_16%,transparent)] text-[var(--ink)] [&_svg]:size-[1.125rem]"
    >
      {children}
    </span>
  );
}

export function BankAccountCards({
  accounts,
  className,
}: {
  accounts: readonly BankAccountCard[];
  className?: string;
}) {
  return (
    <ul className={cn("grid gap-3 md:grid-cols-3 md:gap-3.5", className)}>
      {accounts.map((account) => (
        <li
          key={account.id}
          className="bg-card flex flex-col gap-2 rounded-[1.125rem] border px-4 py-3.5 md:px-[1.125rem] md:py-4"
        >
          {account.kind === "CREDIT_CARD" ? (
            <CardBody account={account} />
          ) : (
            <BankBody account={account} />
          )}
        </li>
      ))}
    </ul>
  );
}

function Header({ account, title }: { account: BankAccountCard; title: string }) {
  const detail = account.sharedPurchases
    ? `${account.institution ?? "Banco"} · compras da ${account.wallet.name}`
    : `${account.institution ?? "Banco"} · ambiente ${account.wallet.name}`;
  return (
    <span className="flex items-center gap-2.5">
      <Tile tone={account.kind === "CREDIT_CARD" ? (account.sharedPurchases ? 4 : 1) : 5}>
        {account.kind === "CREDIT_CARD" ? <CreditCard /> : <Landmark />}
      </Tile>
      <span className="flex min-w-0 flex-col">
        <strong className="truncate text-[0.9375rem]">{title}</strong>
        <span className="text-muted-foreground truncate text-xs">{detail}</span>
      </span>
    </span>
  );
}

function BankBody({ account }: { account: BankAccountCard }) {
  return (
    <>
      <Header account={account} title={account.name} />
      <span className="text-muted-foreground text-[0.8125rem]">Saldo no banco</span>
      <Link
        href={`/lancamentos?conta=${account.id}`}
        className={cn(NUMBER_LINK, "tabular font-mono text-xl font-bold md:text-[1.375rem]")}
      >
        {account.balance?.balance != null ? formatBRL(account.balance.balance) : "—"}
      </Link>
      <span className="text-muted-foreground text-xs">
        {account.balance
          ? `informado pelo banco às ${asOfTime.format(account.balance.asOf)}`
          : "ainda sem busca"}
      </span>
    </>
  );
}

function CardBody({ account }: { account: BankAccountCard }) {
  const b = account.balance;
  const limit = b?.creditLimit ?? null;
  const available = b?.availableCredit ?? null;
  const used = limit !== null && available !== null ? limit - available : null;
  const title = account.lastFour ? `${account.name} final ${account.lastFour}` : account.name;
  return (
    <>
      <Header account={account} title={title} />
      <span className="text-muted-foreground text-[0.8125rem]">Fatura aberta até agora</span>
      <Link
        href={`/carteiras/conta/${account.id}`}
        className={cn(
          NUMBER_LINK,
          "text-expense tabular font-mono text-xl font-bold md:text-[1.375rem]",
        )}
      >
        {formatBRL(account.openTotal ?? 0n)}
        <span className="sr-only">, ver a fatura de {title}</span>
      </Link>
      <span className="text-muted-foreground text-xs">
        fecha {dm(b?.closeDate ?? null)} · vence {dm(b?.dueDate ?? null)}
      </span>
      {limit !== null && available !== null && used !== null ? (
        <>
          <Meter
            used={used}
            total={limit}
            label={`Limite usado: ${usedPercentLabel(used, limit)}. Disponível ${formatBRL(available)} de ${formatBRL(limit)}.`}
          />
          <span className="text-muted-foreground tabular font-mono text-xs">
            disponível {formatBRL(available)} de {formatBRL(limit)}
          </span>
        </>
      ) : null}
    </>
  );
}
