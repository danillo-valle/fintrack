import type { Metadata } from "next";
import Link from "next/link";
import { AuthCard } from "@/features/auth/ui/auth-card";
import { ForgotPasswordForm } from "@/features/auth/ui/forgot-password-form";
import { TEXT_LINK } from "@/lib/styles";

export const metadata: Metadata = { title: "Esqueci a senha" };

export default function ForgotPasswordPage() {
  return (
    <AuthCard
      title="Esqueci a senha"
      description="Vamos mandar um link para você criar uma senha nova."
      footer={
        <Link href="/entrar" className={TEXT_LINK}>
          Voltar para a entrada
        </Link>
      }
    >
      <ForgotPasswordForm />
    </AuthCard>
  );
}
