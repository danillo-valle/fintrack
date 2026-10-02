import type { Metadata } from "next";
import { PiggyBank } from "lucide-react";
import { EmptyState } from "@/components/feedback/empty-state";
import { PageHeader } from "@/components/layout/page-header";
import { requireUser } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Orçamento" };

export default async function BudgetPage() {
  await requireUser(); // toda página do app começa conferindo a sessão (skill auth-guard)

  return (
    <>
      <PageHeader title="Orçamento" description="Quanto a casa planeja gastar por categoria" />
      <EmptyState
        icon={PiggyBank}
        title="Nenhum orçamento definido"
        description="Em breve você vai poder definir limites por categoria e acompanhar o planejado contra o realizado."
      />
    </>
  );
}
