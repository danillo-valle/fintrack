import type { Metadata } from "next";
import { PiggyBank } from "lucide-react";
import { EmptyState } from "@/components/feedback/empty-state";
import { PageHeader } from "@/components/layout/page-header";

export const metadata: Metadata = { title: "Orçamento" };

export default function BudgetPage() {
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
