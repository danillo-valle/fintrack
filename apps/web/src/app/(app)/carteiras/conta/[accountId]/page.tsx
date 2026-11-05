import { notFound, redirect } from "next/navigation";
import { accountPageTarget } from "@/features/bank/server/queries";
import { requireUser } from "@/lib/auth/session";

// O endereço antigo da página de uma conta (M09.1). Desde o M13.3a (ADR-025), o cartão tem a
// página de Cartões, por fatura, e a conta que não é cartão tem Lançamentos, com o saldo. Quem não
// vê a conta recebe 404, como antes.
export default async function AccountPage({ params }: PageProps<"/carteiras/conta/[accountId]">) {
  const session = await requireUser(); // toda página do app começa conferindo a sessão
  const { accountId } = await params;
  const target = await accountPageTarget(session, accountId);
  if (!target) notFound();
  redirect(target);
}
