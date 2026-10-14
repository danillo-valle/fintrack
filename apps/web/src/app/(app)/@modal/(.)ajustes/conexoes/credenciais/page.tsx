import { RouteModal } from "@/components/ui/route-modal";
import { getCredentialsForm } from "@/features/bank/server/queries";
import { CredentialsForm } from "@/features/bank/ui/credentials-form";
import { StepFooter } from "@/features/bank/ui/form-footer";
import { requireRecentAuth } from "@/lib/auth/session";

// Passo 1 de 2 em modal, por cima de Ajustes › Conexões (prancha E-Conectar). A mesma prova de
// identidade da página: sem ela, vai para /reautenticar e volta.
export default async function CredentialsModal() {
  const session = await requireRecentAuth("/ajustes/conexoes/credenciais");
  const form = await getCredentialsForm(session);
  if (!form) {
    return (
      <RouteModal title="Conectar o Meu Pluggy">
        <p className="text-sm">Crie o seu lar em Carteiras antes de conectar um banco.</p>
      </RouteModal>
    );
  }
  return (
    <RouteModal
      title="Conectar o Meu Pluggy"
      eyebrow="Passo 1 de 2 · Credenciais"
      initialFocus="#modal-cred-clientId"
      footer={
        <StepFooter
          formId="modal-form-credenciais"
          submitLabel="Testar e continuar"
          submitIcon="seguir"
          backLabel="Cancelar"
          backHref="/ajustes/conexoes"
          closesModal
        />
      }
    >
      <CredentialsForm idPrefix="modal-cred-" formId="modal-form-credenciais" {...form} />
    </RouteModal>
  );
}
