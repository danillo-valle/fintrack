import type { Metadata } from "next";
import { Wallet } from "lucide-react";
import { EmptyState } from "@/components/feedback/empty-state";
import { PageHeader } from "@/components/layout/page-header";
import { requireUser } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Carteiras" };

export default async function WalletsPage() {
  await requireUser(); // toda página do app começa conferindo a sessão (skill auth-guard)

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
