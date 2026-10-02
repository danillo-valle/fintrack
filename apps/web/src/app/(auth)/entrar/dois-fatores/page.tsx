import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { safeNextPath, signInUrl, TWO_FACTOR_PENDING_COOKIES } from "@/lib/auth/routes";
import { TEXT_LINK } from "@/lib/styles";
import { AuthCard } from "@/features/auth/ui/auth-card";
import { TwoFactorForm } from "@/features/auth/ui/two-factor-form";

export const metadata: Metadata = { title: "Verificação em duas etapas" };

export default async function TwoFactorPage({ searchParams }: PageProps<"/entrar/dois-fatores">) {
  const params = await searchParams;
  const next = safeNextPath(typeof params.next === "string" ? params.next : null);

  // Sem a senha digitada há pouco (cookie do 2FA), qualquer código daria "verificação expirada".
  // Melhor voltar logo para a tela de entrar, guardando o destino.
  const jar = await cookies();
  if (!TWO_FACTOR_PENDING_COOKIES.some((name) => jar.has(name))) redirect(signInUrl(next));

  return (
    <AuthCard
      title="Verificação em duas etapas"
      // Texto neutro: vale para o app autenticador e para o código de backup
      description="A senha está certa. Falta confirmar que é você."
      footer={
        <Link href="/entrar" className={TEXT_LINK}>
          Voltar e entrar com outra conta
        </Link>
      }
    >
      <TwoFactorForm next={next} />
    </AuthCard>
  );
}
