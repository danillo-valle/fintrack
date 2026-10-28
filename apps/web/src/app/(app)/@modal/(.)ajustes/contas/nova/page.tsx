import { StepFooter } from "@/components/feedback/step-footer";
import { RouteModal } from "@/components/ui/route-modal";
import { getNewAccountPage } from "@/features/accounts/server/queries";
import { AccountForm } from "@/features/accounts/ui/account-form";
import { requireUser } from "@/lib/auth/session";

// Nova conta em modal, por cima de Contas e cartões (prancha J-NovaConta; no celular, o painel
// que sobe da base). Dando certo, a action volta para a lista com o aviso no topo.
export default async function NewAccountModal() {
  const session = await requireUser();
  const { wallets } = await getNewAccountPage(session);
  if (wallets.length === 0) {
    return (
      <RouteModal title="Nova conta">
        <p className="text-sm">
          Só quem é dono da carteira cria contas nela. Peça a quem administra a Casa.
        </p>
      </RouteModal>
    );
  }
  return (
    <RouteModal
      title="Nova conta"
      eyebrow="Contas e cartões"
      footer={
        <StepFooter
          formId="modal-form-conta"
          submitLabel="Criar conta"
          submitIcon="confirmar"
          backLabel="Cancelar"
          backHref="/ajustes/contas"
          closesModal
        />
      }
    >
      <AccountForm formId="modal-form-conta" wallets={wallets} />
    </RouteModal>
  );
}
