import type { Metadata } from "next";
import { PageHeader } from "@/components/layout/page-header";
import { NewTransactionForm } from "./new-transaction-form";
import { requireUser } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Novo lançamento" };

export default async function NewTransactionPage() {
  await requireUser(); // toda página do app começa conferindo a sessão (skill auth-guard)

  return (
    <>
      <PageHeader title="Novo lançamento" description="Leva menos de 10 segundos" />
      <NewTransactionForm />
    </>
  );
}
