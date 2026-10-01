import Link from "next/link";
import { Plus, ReceiptText } from "lucide-react";
import { EmptyState } from "@/components/feedback/empty-state";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";

export default function HomePage() {
  return (
    <>
      <PageHeader title="Início" description="Resumo do mês da casa" />
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
