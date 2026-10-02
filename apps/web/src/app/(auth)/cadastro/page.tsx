import type { Metadata } from "next";
import Link from "next/link";
import { AuthCard } from "@/features/auth/ui/auth-card";
import { SignUpForm } from "@/features/auth/ui/sign-up-form";
import { TEXT_LINK } from "@/lib/styles";

export const metadata: Metadata = { title: "Criar conta" };

export default function SignUpPage() {
  return (
    <AuthCard
      title="Criar conta"
      description="O FinTrack é da casa: só os e-mails autorizados conseguem criar conta."
      footer={
        <>
          Já tem conta?{" "}
          <Link href="/entrar" className={TEXT_LINK}>
            Entrar
          </Link>
        </>
      }
    >
      <SignUpForm />
    </AuthCard>
  );
}
