import type { Metadata } from "next";
import Link from "next/link";
import { ChevronRight, House, Plus, Users, Wallet } from "lucide-react";
import { EmptyState } from "@/components/feedback/empty-state";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { getWalletsPage } from "@/features/wallets/server/queries";
import { WALLET_KIND_LABEL, WALLET_ROLE_LABEL } from "@/lib/access-messages";
import { requireUser } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Carteiras" };

// Lista das carteiras de que a pessoa participa (M06). A consulta parte do vínculo da pessoa
// (wallet_member.userId = ela): a carteira de outra pessoa nunca entra nesta lista.
export default async function WalletsPage() {
  const session = await requireUser(); // toda página do app começa conferindo a sessão (skill auth-guard)
  const { wallets, hasHousehold, canCreate } = await getWalletsPage(session);

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
          canCreate ? (
            <Button asChild>
              <Link href="/carteiras/nova">
                <Plus aria-hidden />
                Nova carteira
              </Link>
            </Button>
          ) : null
        }
      />
      {wallets.length === 0 ? (
        <EmptyState
          icon={Wallet}
          title="Nenhuma carteira"
          description="Crie uma carteira compartilhada para os gastos da casa."
        />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {wallets.map((w) => (
            <li key={w.id}>
              <Link
                href={`/carteiras/${w.id}`}
                className="hover:bg-muted focus-visible:ring-ring bg-card flex items-center justify-between gap-3 rounded-xl border p-4 outline-none focus-visible:ring-3 data-[archived=true]:border-dashed"
                data-archived={w.archived}
              >
                <span className="min-w-0">
                  <span className="block font-medium break-words">{w.name}</span>
                  <span className="text-muted-foreground flex flex-wrap items-center gap-x-2 text-sm">
                    {w.kind === "SHARED" ? (
                      <Users aria-hidden className="size-3.5" />
                    ) : (
                      <Wallet aria-hidden className="size-3.5" />
                    )}
                    {WALLET_KIND_LABEL[w.kind]} · {WALLET_ROLE_LABEL[w.role]}
                    {w.kind === "SHARED"
                      ? ` · ${w.memberCount} ${w.memberCount === 1 ? "pessoa" : "pessoas"}`
                      : ""}
                    {w.archived ? " · Arquivada" : ""}
                  </span>
                </span>
                <ChevronRight aria-hidden className="size-4 shrink-0" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
