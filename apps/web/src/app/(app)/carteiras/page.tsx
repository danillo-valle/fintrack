import type { Metadata } from "next";
import Link from "next/link";
import { Archive, ChevronRight, House, Plus, Users, Wallet } from "lucide-react";
import { EmptyState } from "@/components/feedback/empty-state";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { HighlightCard, StatCard, SummaryGrid } from "@/components/visual/summary";
import { NewTransactionButton } from "@/features/transactions/ui/new-transaction-button";
import { IconTile } from "@/components/visual/icon-tile";
import { SurfaceList } from "@/components/visual/surface-list";
import { getWalletsPage } from "@/features/wallets/server/queries";
import { WALLET_KIND_LABEL, WALLET_ROLE_LABEL } from "@/lib/access-messages";
import { requireUser } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Carteiras" };

// Lista das carteiras de que a pessoa participa (M06). A consulta parte do vínculo da pessoa
// (wallet_member.userId = ela): a carteira de outra pessoa nunca entra nesta lista.
export default async function WalletsPage() {
  const session = await requireUser(); // toda página do app começa conferindo a sessão (skill auth-guard)
  const { wallets, hasHousehold, canCreate } = await getWalletsPage(session);
  const active = wallets.filter((w) => !w.archived);

  if (!hasHousehold) {
    return (
      <>
        <PageHeader title="Carteiras" description="Pessoais e compartilhadas" />
        <EmptyState
          icon={House}
          title="Você ainda não tem um lar"
          description="Crie o seu lar para ganhar a carteira pessoal e criar carteiras compartilhadas. Recebeu um convite? Abra o link dele."
          action={
            <Button asChild>
              <Link href="/ajustes/lar">Criar meu lar</Link>
            </Button>
          }
        />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Carteiras"
        description="Cada carteira junta os gastos de quem participa dela"
        actions={
          <>
            {canCreate ? (
              <Button asChild variant="outline" size="lg" className="h-11 rounded-xl">
                <Link href="/carteiras/nova">
                  <Plus aria-hidden />
                  Nova carteira
                </Link>
              </Button>
            ) : null}
            <NewTransactionButton />
          </>
        }
      />
      {wallets.length === 0 ? (
        <EmptyState
          icon={Wallet}
          title="Nenhuma carteira"
          description="Crie uma carteira compartilhada para os gastos da casa."
        />
      ) : (
        <div className="flex flex-col gap-6">
          <SummaryGrid label="Resumo das carteiras">
            <HighlightCard label="Você participa de">
              {active.length} {active.length === 1 ? "carteira" : "carteiras"}
            </HighlightCard>
            <StatCard label="Compartilhadas" icon={<Users />}>
              {active.filter((w) => w.kind === "SHARED").length}
            </StatCard>
            <StatCard label="Pessoal" icon={<Wallet />}>
              {active.filter((w) => w.kind !== "SHARED").length}
            </StatCard>
          </SummaryGrid>

          <SurfaceList aria-label="Suas carteiras">
            {wallets.map((w) => (
              <li key={w.id} className="relative">
                <Link
                  href={`/carteiras/${w.id}`}
                  className="hover:bg-muted focus-visible:ring-ring flex min-h-16 items-center gap-3 px-4 py-3 outline-none focus-visible:ring-3 focus-visible:ring-inset"
                  data-archived={w.archived}
                >
                  <IconTile
                    tone={w.archived ? "neutral" : w.kind === "SHARED" ? 2 : 1}
                    icon={w.archived ? Archive : w.kind === "SHARED" ? Users : Wallet}
                    size="sm"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium break-words">{w.name}</span>
                    <span className="text-muted-foreground block text-sm">
                      {WALLET_KIND_LABEL[w.kind]} · {WALLET_ROLE_LABEL[w.role]}
                      {w.kind === "SHARED"
                        ? ` · ${w.memberCount} ${w.memberCount === 1 ? "pessoa" : "pessoas"}`
                        : ""}
                      {w.archived ? " · Arquivada" : ""}
                    </span>
                  </span>
                  <ChevronRight aria-hidden className="text-muted-foreground size-4 shrink-0" />
                </Link>
              </li>
            ))}
          </SurfaceList>
        </div>
      )}
    </>
  );
}
