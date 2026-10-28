import type { Metadata } from "next";
import { Landmark } from "lucide-react";
import { EmptyState } from "@/components/feedback/empty-state";
import { StepFooter } from "@/components/feedback/step-footer";
import { PageHeader } from "@/components/layout/page-header";
import { getNewAccountPage } from "@/features/accounts/server/queries";
import { AccountForm } from "@/features/accounts/ui/account-form";
import { requireUser } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Nova conta" };

// Nova conta na página inteira (recarregar ou abrir o link direto). Por Contas e cartões, abre em
// modal por cima dela (@modal/(.)ajustes/contas/nova; prancha J-NovaConta).
export default async function NewAccountPage() {
  const session = await requireUser();
  const { wallets } = await getNewAccountPage(session);
  return (
    <>
      <PageHeader
        help="contas-e-cartoes"
        crumb={{ href: "/ajustes/contas", label: "Contas e cartões" }}
        title="Nova conta"
      />
      {wallets.length === 0 ? (
        <EmptyState
          icon={Landmark}
          title="Você não cria contas em nenhuma carteira"
          description="Só quem é dono da carteira cria contas nela. Peça a quem administra a Casa."
        />
      ) : (
        <div className="bg-card flex max-w-xl flex-col gap-5 rounded-[1.25rem] border p-4 md:p-6">
          <AccountForm formId="form-conta" wallets={wallets} />
          <StepFooter
            formId="form-conta"
            submitLabel="Criar conta"
            submitIcon="confirmar"
            backLabel="Cancelar"
            backHref="/ajustes/contas"
          />
        </div>
      )}
    </>
  );
}
