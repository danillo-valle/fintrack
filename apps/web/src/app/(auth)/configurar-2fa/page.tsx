import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { AuthCard } from "@/features/auth/ui/auth-card";
import { SignOutButton } from "@/features/auth/ui/sign-out-button";
import { TwoFactorSetup } from "@/features/auth/ui/two-factor-setup";

export const metadata: Metadata = { title: "Ligar a verificação em duas etapas" };

// Única tela que aceita sessão SEM 2FA: é aqui que o 2FA é ligado.
// Qualquer outra página do app manda para cá enquanto ele não estiver ligado (requireUser).
export default async function TwoFactorSetupPage() {
  const { user } = await requireSession();
  if (user.twoFactorEnabled) redirect("/");

  return (
    <AuthCard
      title="Ligar a verificação em duas etapas"
      description={
        <>
          Obrigatória no FinTrack: além da senha, um código do app autenticador do seu celular.
          Passo 1 de 3.
        </>
      }
      footer={<SignOutButton />}
    >
      <TwoFactorSetup />
    </AuthCard>
  );
}
