import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { googleEnabled } from "@/lib/env";
import { safeNextPath } from "@/lib/auth/routes";
import { getSession } from "@/lib/auth/session";
import { AuthCard } from "@/features/auth/ui/auth-card";
import { SignInForm } from "@/features/auth/ui/sign-in-form";

export const metadata: Metadata = { title: "Entrar" };

const NOTICES: Record<string, string> = {
  "senha-trocada": "Senha trocada. Entre com a senha nova.",
  "email-confirmado": "E-mail confirmado. Entre para continuar.",
};

const ERRORS: Record<string, string> = {
  google:
    "Não foi possível entrar com o Google. O e-mail da conta Google precisa ser o mesmo de uma conta já criada aqui.",
};

export default async function SignInPage({ searchParams }: PageProps<"/entrar">) {
  const params = await searchParams;
  const next = safeNextPath(typeof params.next === "string" ? params.next : null);

  // Quem já está com a sessão completa não precisa ver o login
  const session = await getSession();
  if (session?.user.twoFactorEnabled) redirect(next);

  const aviso = typeof params.aviso === "string" ? NOTICES[params.aviso] : undefined;
  const erro = typeof params.erro === "string" ? ERRORS[params.erro] : undefined;

  return (
    <AuthCard
      title="Entrar no FinTrack"
      description={erro ?? "Use o e-mail e a senha da sua conta, ou a sua passkey."}
      footer={
        <>
          Ainda não tem conta?{" "}
          <Link href="/cadastro" className="text-primary underline underline-offset-4">
            Criar conta
          </Link>
        </>
      }
    >
      <SignInForm next={next} googleEnabled={googleEnabled} notice={aviso} />
    </AuthCard>
  );
}
