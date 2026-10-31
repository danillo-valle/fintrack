import { StepFooter } from "@/components/feedback/step-footer";
import { RouteModal } from "@/components/ui/route-modal";
import { getEditAccountPage } from "@/features/accounts/server/queries";
import { AccountEditForm } from "@/features/accounts/ui/account-edit-form";
import { requireUser } from "@/lib/auth/session";

// Editar conta em modal (M13.2, prancha M-EditarConta; no celular, o painel que sobe da base), por
// cima de Contas e cartões. Dando certo, a action volta com o aviso no topo.
export default async function EditAccountModal({
  params,
}: PageProps<"/ajustes/contas/[accountId]/editar">) {
  const session = await requireUser();
  const { accountId } = await params;
  const page = await getEditAccountPage(session, accountId);
  if (!page) {
    return (
      <RouteModal title="Editar conta">
        <p className="text-sm">
          Esta conta não pode ser editada aqui: ela é de outra carteira, está arquivada ou não
          existe.
        </p>
      </RouteModal>
    );
  }
  return (
    <RouteModal
      title="Editar conta"
      eyebrow={page.account.name}
      footer={
        <StepFooter
          formId="modal-form-editar-conta"
          submitLabel="Salvar"
          submitIcon="confirmar"
          backLabel="Cancelar"
          backHref="/ajustes/contas"
          closesModal
        />
      }
    >
      <AccountEditForm
        formId="modal-form-editar-conta"
        walletId={page.wallet.id}
        account={page.account}
      />
    </RouteModal>
  );
}
