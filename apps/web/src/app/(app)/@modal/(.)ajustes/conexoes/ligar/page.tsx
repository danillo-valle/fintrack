import { RouteModal } from "@/components/ui/route-modal";
import { getLinkPage } from "@/features/bank/server/queries";
import { StepFooter } from "@/features/bank/ui/form-footer";
import { requireRecentAuth } from "@/lib/auth/session";
import { LinkPageBody } from "@/features/bank/ui/link-page-body";

// Passo 2 de 2 em modal (prancha E-Ligar), por cima de Ajustes › Conexões.
export default async function LinkAccountsModal() {
  const session = await requireRecentAuth("/ajustes/conexoes/ligar");
  const page = await getLinkPage(session);
  return (
    <RouteModal
      title="Ligar as contas"
      eyebrow="Passo 2 de 2 · Contas"
      footer={
        page.kind === "ok" ? (
          <StepFooter
            formId="modal-form-ligar"
            submitLabel="Salvar e buscar"
            submitIcon="buscar"
            backLabel="Voltar"
            backHref="/ajustes/conexoes/credenciais"
          />
        ) : undefined
      }
    >
      <LinkPageBody page={page} idPrefix="modal-ligar-" formId="modal-form-ligar" />
    </RouteModal>
  );
}
