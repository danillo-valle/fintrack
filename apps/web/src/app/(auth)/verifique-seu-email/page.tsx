import type { Metadata } from "next";
import Link from "next/link";
import { MailCheck } from "lucide-react";
import { AuthCard } from "@/features/auth/ui/auth-card";

export const metadata: Metadata = { title: "Confirme seu e-mail" };

export default async function CheckEmailPage({ searchParams }: PageProps<"/verifique-seu-email">) {
  const params = await searchParams;
  const email = typeof params.email === "string" ? params.email : null;

  return (
    <AuthCard title="Confirme seu e-mail">
      <div className="flex gap-3 text-sm">
        <MailCheck aria-hidden className="text-primary size-6 shrink-0" />
        <div className="flex flex-col gap-2">
          <p>
            Enviamos um link de confirmação para{" "}
            {email ? <strong className="break-all">{email}</strong> : "o seu e-mail"}. Abra a
            mensagem e toque em <strong>Confirmar e-mail</strong>. O link vale por 1 hora.
          </p>
          <p className="text-muted-foreground">
            Não chegou? Confira o spam. Se tentar entrar sem confirmar, um link novo é enviado.
          </p>
          <p>
            <Link href="/entrar" className="text-primary underline underline-offset-4">
              Ir para a tela de entrada
            </Link>
          </p>
        </div>
      </div>
    </AuthCard>
  );
}
