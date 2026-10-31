import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { StepFooter } from "@/components/feedback/step-footer";
import { PageHeader } from "@/components/layout/page-header";
import { getEditAccountPage } from "@/features/accounts/server/queries";
import { AccountEditForm } from "@/features/accounts/ui/account-edit-form";
import { requireUser } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Editar conta" };

// Editar conta na página inteira (M13.2; recarregar ou abrir o link direto). Pelo menu "⋯" da
// conta, abre em modal (@modal/(.)ajustes/contas/[accountId]/editar; prancha M-EditarConta).
// Conta de outra pessoa, arquivada ou inventada: 404 igual.
export default async function EditAccountPage({
  params,
}: PageProps<"/ajustes/contas/[accountId]/editar">) {
  const session = await requireUser();
  const { accountId } = await params;
  const page = await getEditAccountPage(session, accountId);
  if (!page) notFound();
  return (
    <>
      <PageHeader
        help="contas-e-cartoes"
        crumb={{ href: "/ajustes/contas", label: "Contas e cartões" }}
        title="Editar conta"
        description={page.account.name}
      />
      <div className="bg-card flex max-w-2xl flex-col gap-5 rounded-[1.25rem] border p-4 md:p-6">
        <AccountEditForm
          formId="form-editar-conta"
          walletId={page.wallet.id}
          account={page.account}
        />
        <StepFooter
          formId="form-editar-conta"
          submitLabel="Salvar"
          submitIcon="confirmar"
          backLabel="Cancelar"
          backHref="/ajustes/contas"
        />
      </div>
    </>
  );
}
