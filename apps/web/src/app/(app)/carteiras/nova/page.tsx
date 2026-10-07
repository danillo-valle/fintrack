import type { Metadata } from "next";
import Link from "next/link";
import { House } from "lucide-react";
import { EmptyState } from "@/components/feedback/empty-state";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { getNewWalletPage } from "@/features/wallets/server/queries";
import { CreateWalletForm } from "@/features/wallets/ui/create-wallet-form";
import { requireUser } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Nova carteira" };

export default async function NewWalletPage() {
  const session = await requireUser();
  const page = await getNewWalletPage(session);

  return (
    <>
      <PageHeader title="Nova carteira compartilhada" description="Você será dono desta carteira" />
      {page ? (
        <CreateWalletForm
          others={page.others.map((m) => ({ userId: m.userId, name: m.user.name }))}
        />
      ) : (
        <EmptyState
          icon={House}
          title="Você ainda não tem um lar"
          description="Carteiras compartilhadas pertencem a um lar. Crie o seu primeiro."
          action={
            <Button asChild>
              <Link href="/ajustes/lar">Criar meu lar</Link>
            </Button>
          }
        />
      )}
    </>
  );
}
