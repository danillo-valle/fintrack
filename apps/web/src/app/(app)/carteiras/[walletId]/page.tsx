import type { Metadata } from "next";
import { ActionButton } from "@/components/feedback/action-button";
import { PageHeader } from "@/components/layout/page-header";
import {
  leaveWalletAction,
  removeMemberFromWalletAction,
  setArchivedAction,
} from "@/features/wallets/server/actions";
import { getWalletPage } from "@/features/wallets/server/queries";
import { AddMemberForm } from "@/features/wallets/ui/add-member-form";
import { MemberRoleForm } from "@/features/wallets/ui/member-role-form";
import { RenameWalletForm } from "@/features/wallets/ui/rename-wallet-form";
import { WALLET_KIND_LABEL, WALLET_ROLE_HELP, WALLET_ROLE_LABEL } from "@/lib/access-messages";
import { requireUser } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Carteira" };

const SECTION = "bg-card rounded-2xl border p-5 md:p-6";

// Detalhe de uma carteira (M06). O id vem da URL e é a porta clássica do IDOR: por isso a
// primeira coisa depois da sessão é o crachá de "view". Quem não participa recebe a página 404,
// IDÊNTICA à de um id que não existe. (O status HTTP sai 200: o loading.tsx do grupo (app) já
// mandou o começo da resposta quando a recusa acontece; o Next marca a página com noindex.
// Veja o ADR-006.)
export default async function WalletPage({ params }: PageProps<"/carteiras/[walletId]">) {
  const session = await requireUser();
  const { walletId } = await params;
  const { wallet, can, addable } = await getWalletPage(session, walletId);
  const archived = wallet.archivedAt !== null;

  return (
    <>
      <PageHeader
        title={wallet.name}
        description={`${WALLET_KIND_LABEL[wallet.kind]}${archived ? " · Arquivada" : ""} · você é ${WALLET_ROLE_LABEL[wallet.myRole].toLowerCase()} (${WALLET_ROLE_HELP[wallet.myRole]})`}
      />
      <div className="flex max-w-2xl flex-col gap-6">
        <section aria-labelledby="participantes" className={SECTION}>
          <h2 id="participantes" className="mb-3 font-semibold">
            Quem participa
          </h2>
          <ul className="divide-y">
            {wallet.members.map((m) => (
              <li key={m.userId} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="font-medium break-words">
                    {m.user.name}
                    {m.userId === session.user.id ? (
                      <span className="text-muted-foreground"> (você)</span>
                    ) : null}
                  </p>
                  <p className="text-muted-foreground text-sm">{WALLET_ROLE_LABEL[m.role]}</p>
                </div>
                {can.manageMembers ? (
                  <div className="flex flex-wrap items-start gap-2">
                    <MemberRoleForm
                      walletId={wallet.id}
                      userId={m.userId}
                      name={m.user.name}
                      role={m.role}
                    />
                    {m.userId !== session.user.id ? (
                      <ActionButton
                        action={removeMemberFromWalletAction}
                        fields={{ walletId: wallet.id, userId: m.userId }}
                        label={`Remover ${m.user.name} da carteira`}
                        confirm={`Remover ${m.user.name}?`}
                        confirmLabel="Sim, remover"
                      >
                        Remover
                      </ActionButton>
                    ) : null}
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
          {can.manageMembers && addable.length > 0 ? (
            <div className="mt-4 border-t pt-4">
              <h3 className="mb-2 text-sm font-semibold">Adicionar pessoa do lar</h3>
              <AddMemberForm
                walletId={wallet.id}
                people={addable.map((p) => ({ userId: p.userId, name: p.user.name }))}
              />
            </div>
          ) : null}
        </section>

        {can.rename ? (
          <section aria-labelledby="renomear" className={SECTION}>
            <h2 id="renomear" className="mb-3 font-semibold">
              Renomear
            </h2>
            <RenameWalletForm walletId={wallet.id} name={wallet.name} />
          </section>
        ) : null}

        {can.archive || can.leave ? (
          <section aria-labelledby="mais" className={SECTION}>
            <h2 id="mais" className="mb-1 font-semibold">
              Mais opções
            </h2>
            <p className="text-muted-foreground mb-3 text-sm">
              Arquivar esconde a carteira sem apagar nada. Sair tira você da carteira; o último dono
              não sai.
            </p>
            <div className="flex flex-wrap gap-3">
              {can.archive ? (
                <ActionButton
                  action={setArchivedAction}
                  fields={{ walletId: wallet.id, archived: archived ? "false" : "true" }}
                  confirm={archived ? undefined : "Arquivar esta carteira?"}
                  confirmLabel="Sim, arquivar"
                >
                  {archived ? "Desarquivar" : "Arquivar"}
                </ActionButton>
              ) : null}
              {can.leave ? (
                <ActionButton
                  action={leaveWalletAction}
                  fields={{ walletId: wallet.id }}
                  confirm="Sair desta carteira?"
                  confirmLabel="Sim, sair"
                >
                  Sair da carteira
                </ActionButton>
              ) : null}
            </div>
          </section>
        ) : null}
      </div>
    </>
  );
}
