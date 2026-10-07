import type { Metadata } from "next";
import Link from "next/link";
import { MailX } from "lucide-react";
import { EmptyState } from "@/components/feedback/empty-state";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { getInvitePreview, hasHousehold } from "@/features/households/server/queries";
import { AcceptInviteForm } from "@/features/households/ui/accept-invite-form";
import { domainErrorMessage, HOUSEHOLD_ROLE_LABEL } from "@/lib/access-messages";
import { normalizeEmail } from "@fintrack/core";
import { requireUser } from "@/lib/auth/session";

export const metadata: Metadata = {
  title: "Convite",
  // O endereço tem um segredo: nada de indexação nem de enviar a URL para outro site
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

// Tela do convite (M06). Exige login (com 2FA) como o resto do app: quem chega sem sessão vai
// para /entrar e volta para cá depois. A aceitação confere tudo de novo no servidor.
export default async function InvitePage({ params }: PageProps<"/convite/[token]">) {
  const { user } = await requireUser();
  const { token } = await params;
  const invite = await getInvitePreview(token);

  const problem = !invite
    ? "Não encontramos este convite. Confira se o link chegou inteiro."
    : invite.status !== "PENDING"
      ? domainErrorMessage("INVITE_INVALID")
      : normalizeEmail(user.email) !== invite.email
        ? domainErrorMessage("INVITE_WRONG_ACCOUNT")
        : (await hasHousehold(user.id))
          ? domainErrorMessage("ALREADY_IN_HOUSEHOLD")
          : null;

  if (!invite || problem) {
    return (
      <>
        <PageHeader title="Convite" />
        <EmptyState
          icon={MailX}
          title="Não dá para aceitar este convite"
          description={problem ?? ""}
          action={
            <Button asChild variant="outline">
              <Link href="/">Voltar ao início</Link>
            </Button>
          }
        />
      </>
    );
  }

  return (
    <>
      <PageHeader title="Convite para um lar" />
      <section aria-labelledby="convite" className="max-w-md rounded-xl border p-5">
        <h2 id="convite" className="mb-2 text-lg font-semibold break-words">
          {invite.householdName}
        </h2>
        <p className="text-muted-foreground mb-4 text-sm">
          {invite.inviterName ?? "Alguém"} convidou você para participar como{" "}
          {HOUSEHOLD_ROLE_LABEL[invite.role].toLowerCase()}. Ao aceitar, você ganha a sua carteira
          pessoal neste lar e pode ser incluída nas carteiras compartilhadas.
        </p>
        <AcceptInviteForm token={token} />
      </section>
    </>
  );
}
