import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeftRight } from "lucide-react";
import { EmptyState } from "@/components/feedback/empty-state";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { getQuickEntryPage } from "@/features/transactions/server/queries";
import { TransferForm } from "@/features/transactions/ui/transfer-form";
import { requireUser } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Transferência" };

// Transferência entre contas (M07). Só entram as contas que a pessoa administra pela carteira:
// o portador de um cartão adicional não move dinheiro da conta do titular.
export default async function TransferPage() {
  const session = await requireUser();
  const { accounts, defaults } = await getQuickEntryPage(session);
  const own = accounts.filter((a) => a.via === "WALLET");

  return (
    <>
      <PageHeader
        title="Transferência"
        description="Dinheiro que muda de conta: guardar, sacar, pagar a fatura. Não é gasto."
      />
      {own.length >= 2 ? (
        <TransferForm accounts={own} today={defaults.occurredOn} />
      ) : (
        <EmptyState
          icon={ArrowLeftRight}
          title="São precisas duas contas"
          description="Cadastre pelo menos duas contas (por exemplo, a corrente e o cartão) para transferir entre elas."
          action={
            <Button asChild>
              <Link href="/ajustes/contas">Cadastrar conta</Link>
            </Button>
          }
        />
      )}
    </>
  );
}
