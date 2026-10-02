import type { Metadata } from "next";
import Link from "next/link";
import { AuthCard } from "@/features/auth/ui/auth-card";
import { FormAlert } from "@/features/auth/ui/form-alert";
import { ResetPasswordForm } from "@/features/auth/ui/reset-password-form";

export const metadata: Metadata = { title: "Criar senha nova" };

// O link do e-mail passa pelo Better Auth (/api/auth/reset-password/TOKEN), que confere o token
// e redireciona para cá com ?token=... (válido) ou ?error=INVALID_TOKEN (vencido ou usado).
export default async function ResetPasswordPage({ searchParams }: PageProps<"/redefinir-senha">) {
  const params = await searchParams;
  const token = typeof params.token === "string" ? params.token : null;

  return (
    <AuthCard
      title="Criar senha nova"
      footer={
        <Link href="/entrar" className="text-primary underline underline-offset-4">
          Voltar para a entrada
        </Link>
      }
    >
      {token ? (
        <ResetPasswordForm token={token} />
      ) : (
        <>
          <FormAlert message="Este link não é válido ou já foi usado. Peça um novo." />
          <Link
            href="/esqueci-a-senha"
            className="text-primary text-sm underline underline-offset-4"
          >
            Pedir um link novo
          </Link>
        </>
      )}
    </AuthCard>
  );
}
