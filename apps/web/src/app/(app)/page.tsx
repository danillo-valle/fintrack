import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeftRight, Plus, ReceiptText, Repeat, Wallet } from "lucide-react";
import { EmptyState } from "@/components/feedback/empty-state";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { IconTile, type Tone } from "@/components/visual/icon-tile";
import { getTransactionsPage } from "@/features/transactions/server/queries";
import { NewTransactionButton } from "@/features/transactions/ui/new-transaction-button";
import { TotalsSummary } from "@/features/transactions/ui/totals-summary";
import { TransactionList } from "@/features/transactions/ui/transaction-list";
import { requireUser } from "@/lib/auth/session";
import { formatMonth, todayISO } from "@/lib/dates";
import { TEXT_LINK } from "@/lib/styles";

// Título da aba igual ao h1, como nas outras páginas: "Início · FinTrack" (WCAG 2.4.2)
export const metadata: Metadata = { title: "Início" };

const SHORTCUTS: { href: string; label: string; icon: typeof Plus; tone: Tone }[] = [
  { href: "/lancamentos/novo", label: "Novo lançamento", icon: Plus, tone: 1 },
  { href: "/lancamentos/transferencia", label: "Transferência", icon: ArrowLeftRight, tone: 5 },
  { href: "/lancamentos/recorrencias", label: "Recorrências", icon: Repeat, tone: 4 },
  { href: "/carteiras", label: "Carteiras", icon: Wallet, tone: 3 },
];

// Início (M07.2): o resumo do mês no painel elétrico, atalhos e os últimos lançamentos.
// Os números saem da MESMA consulta da lista (com o crachá de escopo do M07): só as carteiras
// que a pessoa vê. O painel completo, com orçamento e gráficos, chega no M08.
export default async function HomePage() {
  // Toda página do app começa conferindo a sessão (skill auth-guard)
  const session = await requireUser();
  const firstName = session.user.name.split(" ")[0] ?? session.user.name;
  const today = todayISO();
  const page = await getTransactionsPage(session, {});
  const month = formatMonth(new Date(`${today}T12:00:00Z`));
  const recent = page.items.slice(0, 5);

  return (
    <>
      <PageHeader
        title="Início"
        description={`Olá, ${firstName}. Este é o resumo do mês.`}
        actions={page.hasWallets ? <NewTransactionButton /> : undefined}
      />

      {page.hasWallets ? (
        <div className="flex flex-col gap-6">
          <TotalsSummary
            totals={page.totals}
            label="Resumo do mês"
            balanceLabel={`Saldo de ${month}`}
            testIdPrefix="inicio"
          />

          <nav aria-label="Atalhos" className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {SHORTCUTS.map((s) => (
              <Link
                key={s.href}
                href={s.href}
                className="bg-card hover:bg-muted focus-visible:ring-ring flex items-center gap-3 rounded-2xl border p-3 text-sm font-medium outline-none focus-visible:ring-3"
              >
                <IconTile tone={s.tone} icon={s.icon} size="sm" />
                {s.label}
              </Link>
            ))}
          </nav>

          <section aria-labelledby="recentes" className="flex flex-col gap-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2 px-1">
              <h2 id="recentes" className="text-lg font-semibold tracking-tight">
                Últimos lançamentos
              </h2>
              <Link href="/lancamentos" className={TEXT_LINK}>
                Ver todos
              </Link>
            </div>
            {recent.length === 0 ? (
              <EmptyState
                icon={ReceiptText}
                title="Nenhum lançamento neste mês"
                description="Registre um gasto ou uma receita para ver o resumo do mês aqui."
                action={
                  <Button asChild>
                    <Link href="/lancamentos/novo">
                      <Plus aria-hidden />
                      Registrar um lançamento
                    </Link>
                  </Button>
                }
              />
            ) : (
              <TransactionList items={recent} today={today} readOnly dayHeading="h3" />
            )}
          </section>
        </div>
      ) : (
        <EmptyState
          icon={ReceiptText}
          title="Nenhum lançamento ainda"
          description="Crie o seu lar em Carteiras para começar a lançar e ver o resumo do mês aqui."
          action={
            <Button asChild>
              <Link href="/carteiras">Ir para Carteiras</Link>
            </Button>
          }
        />
      )}
    </>
  );
}
