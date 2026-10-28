import type { Metadata } from "next";
import Link from "next/link";
import { PiggyBank } from "lucide-react";
import { EmptyState } from "@/components/feedback/empty-state";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { getBudgetEditor } from "@/features/budget/server/queries";
import { BudgetEditor } from "@/features/budget/ui/budget-editor";
import { requireUser } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Editar valores" };

// "Editar valores" na página inteira (recarregar ou abrir o link direto). Pelo app, abre em modal
// por cima do Orçamento (@modal/(.)orcamento/editar).
export default async function BudgetEditPage({ searchParams }: PageProps<"/orcamento/editar">) {
  const session = await requireUser(); // toda página do app começa conferindo a sessão
  const editor = await getBudgetEditor(session, await searchParams);

  if (!editor) {
    return (
      <>
        <PageHeader help="orcamento" title="Editar valores" />
        <EmptyState
          icon={PiggyBank}
          title="Nenhum ambiente para editar"
          description="Só o dono ou o editor de um ambiente muda o orçado dele."
          action={
            <Button asChild>
              <Link href="/orcamento">Voltar ao Orçamento</Link>
            </Button>
          }
        />
      </>
    );
  }

  return (
    <>
      <PageHeader
        help="orcamento"
        title="Editar valores"
        description={`No ambiente ${editor.walletName} · ${editor.monthLabel}`}
      />
      <div className="bg-card max-w-xl rounded-[1.25rem] border p-4 md:p-6">
        <BudgetEditor editor={editor} idPrefix="orcado-" />
      </div>
    </>
  );
}
