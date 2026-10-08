import type { Metadata } from "next";
import Link from "next/link";
import { WalletCards } from "lucide-react";
import { EmptyState } from "@/components/feedback/empty-state";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { getQuickEntryPage } from "@/features/transactions/server/queries";
import { TransactionForm } from "@/features/transactions/ui/transaction-form";
import { requireUser } from "@/lib/auth/session";
import { TEXT_LINK } from "@/lib/styles";

export const metadata: Metadata = { title: "Novo lançamento" };

// Lançamento rápido (M07): valor, descrição e salvar. Categoria sugerida, conta e carteira do
// último lançamento e a data de hoje já vêm preenchidas.
export default async function NewTransactionPage() {
  const session = await requireUser(); // toda página do app começa conferindo a sessão
  const options = await getQuickEntryPage(session);
  const ready = options.wallets.length > 0 && options.accounts.length > 0;

  return (
    <>
      <PageHeader title="Novo lançamento" description="Leva menos de 10 segundos" />
      {ready ? (
        <>
          <TransactionForm options={options} />
          <p className="text-muted-foreground mt-6 max-w-md text-sm">
            Dinheiro que só mudou de conta (guardar na poupança, pagar a fatura)?{" "}
            <Link href="/lancamentos/transferencia" className={TEXT_LINK}>
              Registre uma transferência
            </Link>
            : ela não conta como gasto.
          </p>
        </>
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
