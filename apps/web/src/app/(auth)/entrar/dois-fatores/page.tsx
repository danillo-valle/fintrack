import type { Metadata } from "next";
import Link from "next/link";
import { safeNextPath } from "@/lib/auth/routes";
import { AuthCard } from "@/features/auth/ui/auth-card";
import { TwoFactorForm } from "@/features/auth/ui/two-factor-form";

export const metadata: Metadata = { title: "Verificação em duas etapas" };

export default async function TwoFactorPage({ searchParams }: PageProps<"/entrar/dois-fatores">) {
  const params = await searchParams;
  const next = safeNextPath(typeof params.next === "string" ? params.next : null);

  return (
    <AuthCard
      title="Verificação em duas etapas"
      description="A senha está certa. Falta o código do seu app autenticador."
      footer={
        <Link href="/entrar" className="text-primary underline underline-offset-4">
          Voltar e entrar com outra conta
        </Link>
      }
    >
      <TwoFactorForm next={next} />
    </AuthCard>
  );
}
