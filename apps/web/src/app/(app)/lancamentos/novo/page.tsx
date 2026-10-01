import type { Metadata } from "next";
import { PageHeader } from "@/components/layout/page-header";
import { NewTransactionForm } from "./new-transaction-form";

export const metadata: Metadata = { title: "Novo lançamento" };

export default function NewTransactionPage() {
  return (
    <>
      <PageHeader title="Novo lançamento" description="Leva menos de 10 segundos" />
      <NewTransactionForm />
    </>
  );
}
