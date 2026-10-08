import type { Metadata } from "next";
import { Download } from "lucide-react";
import { todayCivil } from "@fintrack/core";
import { EmptyState } from "@/components/feedback/empty-state";
import { PageHeader } from "@/components/layout/page-header";
import { parseFilters } from "@/features/transactions/schemas";
import { getExportPage } from "@/features/transactions/server/queries";
import { ExportForm } from "@/features/transactions/ui/export-form";
import { requireRecentAuth } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Exportar lançamentos" };

// Exportar CSV (M07): dado sensível. Só o dono da carteira exporta, a tela exige uma prova de
// identidade dos últimos 10 minutos (senão, /reautenticar e volta) e cada exportação fica na
// auditoria (transactions.exported), sem o conteúdo.
export default async function ExportPage({ searchParams }: PageProps<"/lancamentos/exportar">) {
  const session = await requireRecentAuth("/lancamentos/exportar");
  const { filters, walletId } = parseFilters(await searchParams, todayCivil());
  const { wallets } = await getExportPage(session);

  return (
    <>
      <PageHeader
        title="Exportar lançamentos"
        description="Um arquivo CSV que abre direto no Excel (separador ; e vírgula decimal)"
      />
      {wallets.length === 0 ? (
        <EmptyState
          icon={Download}
          title="Só o dono exporta"
          description="Você não é dono de nenhuma carteira ativa. Peça a quem é dono para exportar."
        />
      ) : (
        <>
          <p className="text-muted-foreground mb-4 max-w-md text-sm">
            O arquivo leva os lançamentos da carteira no período, inclusive transferências. A
            exportação fica registrada na atividade do lar.
          </p>
          <ExportForm
            wallets={wallets}
            defaults={{
              walletId: wallets.some((w) => w.id === walletId) ? walletId : null,
              from: filters.from,
              to: filters.to,
            }}
          />
        </>
      )}
    </>
  );
}
