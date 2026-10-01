import type { Metadata } from "next";
import { Wallet } from "lucide-react";
import { EmptyState } from "@/components/feedback/empty-state";
import { PageHeader } from "@/components/layout/page-header";

export const metadata: Metadata = { title: "Carteiras" };

export default function WalletsPage() {
  return (
    <>
      <PageHeader title="Carteiras" description="Pessoais e conjunta" />
      <EmptyState
        icon={Wallet}
        title="Nenhuma carteira ainda"
        description="Em breve cada pessoa terá a sua carteira pessoal, e a casa uma carteira conjunta."
      />
    </>
  );
}
