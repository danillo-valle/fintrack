import type { Metadata } from "next";
import Link from "next/link";
import { AuthCard } from "@/features/auth/ui/auth-card";
import { ForgotPasswordForm } from "@/features/auth/ui/forgot-password-form";

export const metadata: Metadata = { title: "Esqueci a senha" };

export default function ForgotPasswordPage() {
  return (
    <AuthCard
      title="Esqueci a senha"
      description="Mandamos um link para você criar uma senha nova."
      footer={
        <Link href="/entrar" className="text-primary underline underline-offset-4">
          Voltar para a entrada
        </Link>
      }
    >
      <ForgotPasswordForm />
    </AuthCard>
  );
}
