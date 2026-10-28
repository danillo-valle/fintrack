import type { Metadata } from "next";
import { PageHeader } from "@/components/layout/page-header";
import { getCredentialsForm } from "@/features/bank/server/queries";
import { CredentialsForm } from "@/features/bank/ui/credentials-form";
import { StepFooter } from "@/components/feedback/step-footer";
import { requireRecentAuth } from "@/lib/auth/session";
import { notFound } from "next/navigation";

export const metadata: Metadata = { title: "Conectar o Meu Pluggy" };

// Passo 1 de 2 na página inteira (recarregar ou abrir o link direto). Pelo app, abre em modal
// por cima de Ajustes › Conexões (@modal/(.)ajustes/conexoes/credenciais). Conectar banco é ação
// sensível: pede uma prova de identidade dos últimos 10 minutos (reautenticação, M03).
export default async function CredentialsPage() {
  const session = await requireRecentAuth("/ajustes/conexoes/credenciais");
  const form = await getCredentialsForm(session);
  if (!form) notFound();
  return (
    <>
      <PageHeader
        help="meu-pluggy"
        title="Conectar o Meu Pluggy"
        description="Passo 1 de 2 · Credenciais"
      />
      <div className="bg-card flex max-w-xl flex-col gap-5 rounded-[1.25rem] border p-4 md:p-6">
        <CredentialsForm idPrefix="cred-" formId="form-credenciais" {...form} />
        <StepFooter
          formId="form-credenciais"
          submitLabel="Testar e continuar"
          submitIcon="seguir"
          backLabel="Cancelar"
          backHref="/ajustes/conexoes"
        />
      </div>
    </>
  );
}
