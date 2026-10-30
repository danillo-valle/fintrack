import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { StepFooter } from "@/components/feedback/step-footer";
import { PageHeader } from "@/components/layout/page-header";
import { getEditCardPage } from "@/features/accounts/server/queries";
import { CardForm } from "@/features/accounts/ui/card-form";
import { requireUser } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Editar cartão" };

// Editar cartão na página inteira (M13.1; recarregar ou abrir o link direto). Pelo menu "⋯" do
// cartão, abre em modal (@modal/(.)ajustes/contas/[accountId]/cartao/[cardId]; prancha
// L-EditarCartao). Cartão de outra pessoa, arquivado ou inventado: 404 igual.
export default async function EditCardPage({
  params,
  searchParams,
}: PageProps<"/ajustes/contas/[accountId]/cartao/[cardId]">) {
  const session = await requireUser();
  const { accountId, cardId } = await params;
  const back = (await searchParams).volta === "conta" ? "conta" : "contas";
  const page = await getEditCardPage(session, accountId, cardId);
  if (!page) notFound();
  const backHref = back === "conta" ? `/ajustes/contas/${accountId}` : "/ajustes/contas";
  return (
    <>
      <PageHeader
        help="contas-e-cartoes"
        crumb={{ href: backHref, label: page.account.name }}
        title="Editar cartão"
        description={`${page.card.brand} ···· ${page.card.lastFour}`}
      />
      <div className="bg-card flex max-w-2xl flex-col gap-5 rounded-[1.25rem] border p-4 md:p-6">
        <CardForm
          formId="form-editar-cartao"
          walletId={page.wallet.id}
          accountId={page.account.id}
          people={page.people}
          me={page.me}
          back={back}
          editing={{
            card: page.card,
            account: { holderId: page.account.holderId, walletId: page.wallet.id },
            wallets: page.wallets,
          }}
        />
        <StepFooter
          formId="form-editar-cartao"
          submitLabel="Salvar"
          submitIcon="confirmar"
          backLabel="Cancelar"
          backHref={backHref}
        />
      </div>
    </>
  );
}
