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
        <span className="flex flex-col gap-2">
          <Link href="/primeiro-acesso" className={TEXT_LINK}>
            Primeira vez? Veja o passo a passo
          </Link>
          <span>
            Já tem conta?{" "}
            <Link href="/entrar" className={TEXT_LINK}>
              Entrar
            </Link>
          </span>
        </span>
      }
    >
      <SignUpForm />
    </AuthCard>
  );
}
