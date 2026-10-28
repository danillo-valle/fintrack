import type { Metadata } from "next";
import { PageHeader } from "@/components/layout/page-header";
import { getLinkPage } from "@/features/bank/server/queries";
import { StepFooter } from "@/components/feedback/step-footer";
import { requireRecentAuth } from "@/lib/auth/session";
import { LinkPageBody } from "@/features/bank/ui/link-page-body";

export const metadata: Metadata = { title: "Ligar as contas" };

// Passo 2 de 2 na página inteira. As contas do banco são lidas na hora (com tempo limite) e de
// novo na gravação: a tela não decide quais contas existem.
export default async function LinkAccountsPage() {
  const session = await requireRecentAuth("/ajustes/conexoes/ligar");
  const page = await getLinkPage(session);
  return (
    <>
      <PageHeader help="meu-pluggy" title="Ligar as contas" description="Passo 2 de 2 · Contas" />
      <div className="bg-card flex max-w-3xl flex-col gap-5 rounded-[1.25rem] border p-4 md:p-6">
        <LinkPageBody page={page} idPrefix="ligar-" formId="form-ligar" />
        {page.kind === "ok" ? (
          <StepFooter
            formId="form-ligar"
            submitLabel="Salvar e buscar agora"
            submitIcon="buscar"
            backLabel="Voltar"
            backHref="/ajustes/conexoes/credenciais"
          />
        ) : null}
      </div>
    </>
  );
}
