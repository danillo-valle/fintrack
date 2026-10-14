// O corpo do passo 2 (página e modal usam o mesmo): o formulário, ou o motivo de não ter.
import Link from "next/link";
import { providerErrorMessage } from "@/features/bank/messages";
import type { LinkPage } from "@/features/bank/server/queries";
import { LinkForm } from "./link-form";
import { TEXT_LINK } from "@/lib/styles";

export function LinkPageBody({
  page,
  idPrefix,
  formId,
}: {
  page: LinkPage;
  idPrefix: string;
  formId: string;
}) {
  if (page.kind === "no-connection") {
    return (
      <p className="text-sm">
        Primeiro, as credenciais.{" "}
        <Link href="/ajustes/conexoes/credenciais" className={TEXT_LINK}>
          Conectar o Meu Pluggy
        </Link>
      </p>
    );
  }
  if (page.kind === "error") {
    return (
      <p role="alert" className="bg-expense/10 rounded-xl p-3 text-sm">
        {providerErrorMessage(page.code)}
      </p>
    );
  }
  return <LinkForm data={page} idPrefix={idPrefix} formId={formId} />;
}
