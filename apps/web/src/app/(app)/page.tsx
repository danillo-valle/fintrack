import type { Metadata } from "next";
import Link from "next/link";
import { Plus, ReceiptText } from "lucide-react";
import { EmptyState } from "@/components/feedback/empty-state";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { requireUser } from "@/lib/auth/session";

// Título da aba igual ao h1, como nas outras páginas: "Início · FinTrack" (WCAG 2.4.2)
export const metadata: Metadata = { title: "Início" };

export default async function HomePage() {
  // Toda página do app começa conferindo a sessão (skill auth-guard)
  const { user } = await requireUser();
  const firstName = user.name.split(" ")[0] ?? user.name;

  return (
    <>
      <PageHeader
        title="Início"
        description={`Olá, ${firstName}. Este é o resumo do mês da casa.`}
      />
      <EmptyState
        icon={ReceiptText}
        title="Nenhum lançamento ainda"
        description="Registre um gasto ou uma receita para ver o resumo do mês aqui."
        action={
          <Button asChild>
            <Link href="/lancamentos/novo">
              <Plus aria-hidden />
              Registrar o primeiro lançamento
            </Link>
          </Button>
        }
      />
    </>
  );
}
