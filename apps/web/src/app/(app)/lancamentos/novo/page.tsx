import type { Metadata } from "next";
import Link from "next/link";
import { WalletCards } from "lucide-react";
import { EmptyState } from "@/components/feedback/empty-state";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { getQuickEntryPage } from "@/features/transactions/server/queries";
import {
  EntryTabs,
  entryTabHref,
  parseEntryTab,
} from "@/features/transactions/ui/entry/entry-tabs";
import { OtherEntryForm } from "@/features/transactions/ui/entry/other-entry-form";
import { TransactionForm } from "@/features/transactions/ui/transaction-form";
import { requireUser } from "@/lib/auth/session";
import { TEXT_LINK } from "@/lib/styles";

export const metadata: Metadata = { title: "Novo lançamento" };

// Lançamento rápido (M07): valor, descrição e salvar. Categoria sugerida, conta e carteira do
// último lançamento e a data de hoje já vêm preenchidas. M13.3a: Transferência e Recorrência são
// abas da mesma tela (`?aba=`), como no modal.
export default async function NewTransactionPage({ searchParams }: PageProps<"/lancamentos/novo">) {
  const session = await requireUser(); // toda página do app começa conferindo a sessão
  const tab = parseEntryTab((await searchParams).aba);
  const options = await getQuickEntryPage(session);
  const ready = options.wallets.length > 0 && options.accounts.length > 0;

  return (
    <>
      <PageHeader
        help="lancar-um-gasto"
        title="Novo lançamento"
        description="Leva menos de 10 segundos"
      />
      {ready ? (
        <div className="flex max-w-md flex-col gap-6">
          <EntryTabs current={tab} />
          {tab === "lancamento" ? (
            <>
              <TransactionForm options={options} />
              <p className="text-muted-foreground text-sm">
                Dinheiro que só mudou de conta (guardar na poupança, pagar a fatura)?{" "}
                <Link href={entryTabHref("transferencia")} className={TEXT_LINK}>
                  Registre uma transferência
                </Link>
                : ela não conta como gasto.
              </p>
            </>
          ) : (
            <OtherEntryForm tab={tab} options={options} />
          )}
        </div>
      ) : (
        <EmptyState
          icon={WalletCards}
          title={options.wallets.length === 0 ? "Você ainda não tem um lar" : "Cadastre uma conta"}
          description={
            options.wallets.length === 0
              ? "Crie o seu lar (ou aceite um convite) em Carteiras para começar a lançar."
              : "Todo lançamento sai de uma conta: conta corrente, cartão, vale ou dinheiro."
          }
          action={
            <Button asChild>
              <Link href={options.wallets.length === 0 ? "/carteiras" : "/ajustes/contas"}>
                {options.wallets.length === 0 ? "Ir para Carteiras" : "Cadastrar conta"}
              </Link>
            </Button>
          }
        />
      )}
    </>
  );
}
