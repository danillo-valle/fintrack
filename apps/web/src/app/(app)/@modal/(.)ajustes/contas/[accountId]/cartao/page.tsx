import { StepFooter } from "@/components/feedback/step-footer";
import { RouteModal } from "@/components/ui/route-modal";
import { getCardFormPage } from "@/features/accounts/server/queries";
import { CardForm } from "@/features/accounts/ui/card-form";
import { requireUser } from "@/lib/auth/session";

// Adicionar cartão em modal, por cima da lista ou da página da conta (prancha J-AdicionarCartao;
// no celular, o painel que sobe da base). Dando certo, a action volta com o aviso.
export default async function AddCardModal({
  params,
  searchParams,
}: PageProps<"/ajustes/contas/[accountId]/cartao">) {
  const session = await requireUser();
  const { accountId } = await params;
  const back = (await searchParams).volta === "conta" ? "conta" : "contas";
  const page = await getCardFormPage(session, accountId);
  if (!page) {
    return (
      <RouteModal title="Adicionar cartão">
        <p className="text-sm">
          Esta conta não aceita cartão aqui: ela é de outra carteira, está arquivada ou não é de
          cartão de crédito ou vale.
        </p>
      </RouteModal>
    );
  }
  return (
    <RouteModal
      title="Adicionar cartão"
      eyebrow={page.account.name}
      footer={
        <StepFooter
          formId="modal-form-cartao"
          submitLabel="Adicionar cartão"
          submitIcon="confirmar"
          backLabel="Cancelar"
          backHref={back === "conta" ? `/ajustes/contas/${accountId}` : "/ajustes/contas"}
          closesModal
        />
      }
    >
      <CardForm
        formId="modal-form-cartao"
        walletId={page.wallet.id}
        accountId={page.account.id}
        people={page.people}
        me={page.me}
        back={back}
      />
    </RouteModal>
  );
}
