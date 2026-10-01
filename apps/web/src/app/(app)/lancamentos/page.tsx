import type { Metadata } from "next";
import Link from "next/link";
import { Plus, ReceiptText } from "lucide-react";
import { EmptyState } from "@/components/feedback/empty-state";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = { title: "Lançamentos" };

export default function TransactionsPage() {
  return (
    <>
      <PageHeader
        title="Lançamentos"
        description="Tudo o que entrou e saiu, das duas carteiras"
        actions={
          <Button asChild variant="outline" className="hidden md:inline-flex">
            <Link href="/lancamentos/novo">
              <Plus aria-hidden />
              Novo lançamento
            </Link>
          </Button>
        }
      />
      <EmptyState
        icon={ReceiptText}
        title="Nenhum lançamento neste período"
        description="Quando você registrar gastos e receitas, eles aparecem aqui, do mais recente para o mais antigo."
        action={
          <Button asChild>
            <Link href="/lancamentos/novo">Registrar lançamento</Link>
          </Button>
        }
      />
    </>
  );
}
