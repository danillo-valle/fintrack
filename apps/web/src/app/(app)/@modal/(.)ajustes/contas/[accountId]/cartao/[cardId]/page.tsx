import { StepFooter } from "@/components/feedback/step-footer";
import { RouteModal } from "@/components/ui/route-modal";
import { getEditCardPage } from "@/features/accounts/server/queries";
import { CardForm } from "@/features/accounts/ui/card-form";
import { requireUser } from "@/lib/auth/session";

// Editar cartão em modal (M13.1, prancha L-EditarCartao; no celular, o painel que sobe da base),
// por cima da lista ou da página da conta. Dando certo, a action volta com o aviso no topo.
export default async function EditCardModal({
  params,
  searchParams,
}: PageProps<"/ajustes/contas/[accountId]/cartao/[cardId]">) {
  const session = await requireUser();
  const { accountId, cardId } = await params;
  const back = (await searchParams).volta === "conta" ? "conta" : "contas";
  const page = await getEditCardPage(session, accountId, cardId);
  if (!page) {
    return (
      <RouteModal title="Editar cartão">
        <p className="text-sm">
          Este cartão não pode ser editado aqui: ele é de outra carteira, está arquivado ou não
          existe.
        </p>
      </RouteModal>
    );
  }
  return (
    <RouteModal
      title="Editar cartão"
      eyebrow={`${page.account.name} · ${page.card.brand} ···· ${page.card.lastFour}`}
      footer={
        <StepFooter
          formId="modal-form-editar-cartao"
          submitLabel="Salvar"
          submitIcon="confirmar"
          backLabel="Cancelar"
          backHref={back === "conta" ? `/ajustes/contas/${accountId}` : "/ajustes/contas"}
          closesModal
        />
      }
    >
      <CardForm
        formId="modal-form-editar-cartao"
        walletId={page.wallet.id}
        accountId={page.account.id}
        people={page.people}
        me={page.me}
        back={back}
        editing={{
          card: page.card,
          account: { holderId: page.account.holderId, walletId: page.wallet.id },
          wallets: page.wallets,
        }}
      />
    </RouteModal>
  );
}
