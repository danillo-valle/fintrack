import type { Metadata } from "next";
import { ActionButton } from "@/components/feedback/action-button";
import { PageHeader } from "@/components/layout/page-header";
import { getHouseholdPage } from "@/features/households/server/queries";
import { removeMemberAction, revokeInviteAction } from "@/features/households/server/actions";
import { CreateHouseholdForm } from "@/features/households/ui/create-household-form";
import { InviteForm } from "@/features/households/ui/invite-form";
import { auditActionLabel, HOUSEHOLD_ROLE_LABEL } from "@/lib/access-messages";
import { requireUser } from "@/lib/auth/session";
import { formatDateTime } from "@/lib/dates";

export const metadata: Metadata = { title: "Lar" };

const SECTION = "bg-card rounded-2xl border p-5 md:p-6";

// Ajustes > Lar (M06): criar o lar, ver quem participa, convidar e acompanhar a atividade.
// Cada bloco só chega ao HTML se o papel permitir (a consulta nem é feita para quem não pode).
export default async function HouseholdPage() {
  const session = await requireUser();
  const page = await getHouseholdPage(session);

  if (!page) {
    return (
      <>
        <PageHeader title="Lar" description="O grupo de pessoas que divide as finanças" />
        <section aria-labelledby="criar-lar" className={`${SECTION} max-w-xl`}>
          <h2 id="criar-lar" className="mb-1 font-semibold">
            Crie o seu lar
          </h2>
          <p className="text-muted-foreground mb-4 text-sm">
            Recebeu um convite? Não crie um lar: abra o link do convite. Por enquanto, cada pessoa
            participa de um lar só.
          </p>
          <CreateHouseholdForm />
        </section>
      </>
    );
  }

  const { household, myRole, canManage, members, invites, activity } = page;
  return (
    <>
      <PageHeader
        title={household.name}
        description={`Lar · você é ${HOUSEHOLD_ROLE_LABEL[myRole].toLowerCase()}`}
      />
      <div className="flex max-w-2xl flex-col gap-6">
        <section aria-labelledby="pessoas" className={SECTION}>
          <h2 id="pessoas" className="mb-3 font-semibold">
            Pessoas
          </h2>
          <ul className="divide-y">
            {members.map((m) => (
              <li key={m.userId} className="flex flex-wrap items-center justify-between gap-2 py-3">
                <div className="min-w-0">
                  <p className="font-medium break-words">
                    {m.user.name}
                    {m.userId === session.user.id ? (
                      <span className="text-muted-foreground"> (você)</span>
                    ) : null}
                  </p>
                  <p className="text-muted-foreground text-sm break-all">
                    {HOUSEHOLD_ROLE_LABEL[m.role]} · {m.user.email}
                  </p>
                </div>
                {canManage && m.role === "MEMBER" ? (
                  <ActionButton
                    action={removeMemberAction}
                    fields={{ userId: m.userId }}
                    label={`Remover ${m.user.name} do lar`}
                    confirm={`Remover ${m.user.name} do lar?`}
                    confirmLabel="Sim, remover"
                  >
                    Remover
                  </ActionButton>
                ) : null}
              </li>
            ))}
          </ul>
        </section>

        {canManage ? (
          <section aria-labelledby="convidar" className={SECTION}>
            <h2 id="convidar" className="mb-1 font-semibold">
              Convidar
            </h2>
            <p className="text-muted-foreground mb-4 text-sm">
              A pessoa precisa ter conta no FinTrack com o mesmo e-mail (o cadastro continua fechado
              à lista de e-mails autorizados).
            </p>
            <InviteForm />
            {invites.length > 0 ? (
              <>
                <h3 className="mt-6 mb-2 text-sm font-semibold">Convites em aberto</h3>
                <ul className="divide-y">
                  {invites.map((invite) => {
                    const { expired } = invite;
                    return (
                      <li
                        key={invite.id}
                        className="flex flex-wrap items-center justify-between gap-2 py-3"
                      >
                        <div className="min-w-0 text-sm">
                          <p className="font-medium break-all">{invite.email}</p>
                          <p className="text-muted-foreground">
                            {HOUSEHOLD_ROLE_LABEL[invite.role]} ·{" "}
                            {expired ? "expirou em " : "vale até "}
                            {formatDateTime(invite.expiresAt)}
                          </p>
                        </div>
                        <ActionButton
                          action={revokeInviteAction}
                          fields={{ inviteId: invite.id }}
                          label={`Cancelar o convite de ${invite.email}`}
                        >
                          Cancelar
                        </ActionButton>
                      </li>
                    );
                  })}
                </ul>
              </>
            ) : null}
          </section>
        ) : null}

        {activity.length > 0 ? (
          <section aria-labelledby="atividade" className={SECTION}>
            <h2 id="atividade" className="mb-1 font-semibold">
              Atividade do lar
            </h2>
            <p className="text-muted-foreground mb-3 text-sm">
              Trilha de auditoria: só acrescenta, ninguém apaga nem edita.
            </p>
            <ol className="flex flex-col gap-2 text-sm">
              {activity.map((event) => (
                <li key={event.id} className="flex flex-wrap gap-x-2">
                  <time
                    className="text-muted-foreground tabular"
                    dateTime={event.createdAt.toISOString()}
                  >
                    {formatDateTime(event.createdAt)}
                  </time>
                  <span>
                    <strong className="font-medium">{event.actorName}</strong>{" "}
                    {auditActionLabel(event.action)}
                  </span>
                </li>
              ))}
            </ol>
          </section>
        ) : null}
      </div>
    </>
  );
}
