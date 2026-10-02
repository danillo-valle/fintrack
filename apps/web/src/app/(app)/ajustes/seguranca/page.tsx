import type { Metadata } from "next";
import { CircleCheck } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { requireUser } from "@/lib/auth/session";
import { listMyPasskeys, listMySessions } from "@/features/auth/server/queries";
import { ChangePasswordForm } from "@/features/auth/ui/change-password-form";
import { PasskeyManager } from "@/features/auth/ui/passkey-manager";
import { RegenerateBackupCodes } from "@/features/auth/ui/regenerate-backup-codes";
import { SessionList } from "@/features/auth/ui/session-list";

export const metadata: Metadata = { title: "Segurança" };

function Section({
  id,
  title,
  description,
  children,
}: {
  id: string;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="rounded-xl border p-5">
      <h2 id={id} className="font-semibold">
        {title}
      </h2>
      <p className="text-muted-foreground mt-1 mb-4 text-sm">{description}</p>
      {children}
    </section>
  );
}

export default async function SecurityPage() {
  const { user, session } = await requireUser();
  const [sessions, passkeys] = await Promise.all([
    listMySessions(user.id),
    listMyPasskeys(user.id),
  ]);

  return (
    <>
      <PageHeader title="Segurança" description="Como você entra e onde a sua conta está aberta" />
      <div className="flex max-w-2xl flex-col gap-6">
        <Section
          id="senha"
          title="Senha"
          description="Troque quando quiser, sabendo a senha atual. Esqueceu? Saia e use o Esqueci a senha na tela de entrar."
        >
          <ChangePasswordForm />
        </Section>

        <Section
          id="dois-fatores"
          title="Verificação em duas etapas"
          description="Obrigatória no FinTrack. Ao entrar com senha, o app autenticador confirma que é você."
        >
          <p className="text-income mb-4 flex items-center gap-2 text-sm font-medium">
            <CircleCheck aria-hidden className="size-4" />
            Ligada com app autenticador
          </p>
          <h3 className="mb-2 text-sm font-semibold">Códigos de backup</h3>
          <RegenerateBackupCodes />
        </Section>

        <Section
          id="passkeys"
          title="Passkeys"
          description="Entrar pela digital, pelo rosto ou pelo PIN do aparelho. Resistem a sites falsos."
        >
          <PasskeyManager passkeys={passkeys} />
        </Section>

        <Section
          id="sessoes"
          title="Sessões ativas"
          description="Aparelhos onde a sua conta está aberta. Encerre o que você não reconhecer."
        >
          <SessionList sessions={sessions} currentId={session.id} />
        </Section>
      </div>
    </>
  );
}
