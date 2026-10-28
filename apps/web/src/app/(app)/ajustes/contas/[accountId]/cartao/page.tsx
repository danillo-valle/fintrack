import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { StepFooter } from "@/components/feedback/step-footer";
import { PageHeader } from "@/components/layout/page-header";
import { getCardFormPage } from "@/features/accounts/server/queries";
import { CardForm } from "@/features/accounts/ui/card-form";
import { requireUser } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Adicionar cartão" };

// Adicionar cartão na página inteira (recarregar ou abrir o link direto). Pela lista ou pela
// página da conta, abre em modal (@modal/(.)ajustes/contas/[accountId]/cartao; prancha
// J-AdicionarCartao). Conta de outra pessoa, arquivada ou que não aceita cartão: 404 igual.
export default async function AddCardPage({
  params,
  searchParams,
}: PageProps<"/ajustes/contas/[accountId]/cartao">) {
  const session = await requireUser();
  const { accountId } = await params;
  const back = (await searchParams).volta === "conta" ? "conta" : "contas";
  const page = await getCardFormPage(session, accountId);
  if (!page) notFound();
  const backHref = back === "conta" ? `/ajustes/contas/${accountId}` : "/ajustes/contas";
  return (
    <>
      <PageHeader
        help="contas-e-cartoes"
        crumb={{ href: backHref, label: page.account.name }}
        title="Adicionar cartão"
      />
      <div className="bg-card flex max-w-xl flex-col gap-5 rounded-[1.25rem] border p-4 md:p-6">
        <CardForm
          formId="form-cartao"
          walletId={page.wallet.id}
          accountId={page.account.id}
          people={page.people}
          me={page.me}
          back={back}
        />
        <StepFooter
          formId="form-cartao"
          submitLabel="Adicionar cartão"
          submitIcon="confirmar"
          backLabel="Cancelar"
          backHref={backHref}
        />
      </div>
    </>
  );
}
