import type { Metadata } from "next";
import Link from "next/link";
import { AuthCard } from "@/features/auth/ui/auth-card";
import { SignUpForm } from "@/features/auth/ui/sign-up-form";

export const metadata: Metadata = { title: "Criar conta" };

export default function SignUpPage() {
  return (
    <AuthCard
      title="Criar conta"
      description="O FinTrack é da casa: só os e-mails autorizados conseguem criar conta."
      footer={
        <>
          Já tem conta?{" "}
          <Link href="/entrar" className="text-primary underline underline-offset-4">
            Entrar
          </Link>
        </>
      }
    >
      <SignUpForm />
    </AuthCard>
  );
}
