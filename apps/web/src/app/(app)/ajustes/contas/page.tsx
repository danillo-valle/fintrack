import type { Metadata } from "next";
import { Landmark } from "lucide-react";
import { ActionButton } from "@/components/feedback/action-button";
import { EmptyState } from "@/components/feedback/empty-state";
import { PageHeader } from "@/components/layout/page-header";
import {
  setAccountArchivedAction,
  setCardArchivedAction,
} from "@/features/accounts/server/actions";
import { getAccountsPage } from "@/features/accounts/server/queries";
import { AccountForm } from "@/features/accounts/ui/account-form";
import { CardForm } from "@/features/accounts/ui/card-form";
import { requireUser } from "@/lib/auth/session";
import { ACCOUNT_KIND_LABEL, CARD_FORM_LABEL } from "@/lib/labels";

export const metadata: Metadata = { title: "Contas e cartões" };

const SECTION = "rounded-xl border p-5";

// Contas e cartões (M07), por carteira. Quem é dono da carteira cria e arquiva; os outros veem.
export default async function AccountsPage() {
  const session = await requireUser();
  const { sections, people, me } = await getAccountsPage(session);
  const manageable = sections.filter((s) => s.canManage).map((s) => s.wallet);

  return (
    <>
      <PageHeader title="Contas e cartões" description="De onde o dinheiro sai e para onde entra" />
      <div className="flex max-w-2xl flex-col gap-6">
        {sections.length === 0 ? (
          <EmptyState
            icon={Landmark}
            title="Você ainda não tem um lar"
            description="Crie o seu lar em Carteiras primeiro."
          />
        ) : null}
        {sections.map((s) => (
          <section key={s.wallet.id} aria-labelledby={`w-${s.wallet.id}`} className={SECTION}>
            <h2 id={`w-${s.wallet.id}`} className="mb-3 font-semibold break-words">
              {s.wallet.name}
            </h2>
            {s.accounts.length === 0 ? (
              <p className="text-muted-foreground text-sm">Nenhuma conta nesta carteira.</p>
            ) : (
              <ul className="divide-y">
                {s.accounts.map((a) => (
                  <li key={a.id} className="py-3">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-medium break-words">
                          {a.name}
                          {a.archivedAt ? (
                            <span className="text-muted-foreground"> (arquivada)</span>
                          ) : null}
                        </p>
                        <p className="text-muted-foreground text-sm">
                          {ACCOUNT_KIND_LABEL[a.kind]}
                          {a.closingDay
                            ? ` · fecha dia ${a.closingDay}, vence dia ${a.dueDay}`
                            : ""}
                          {a.institution ? ` · ${a.institution}` : ""}
                        </p>
                      </div>
                      {s.canManage ? (
                        <ActionButton
                          action={setAccountArchivedAction}
                          fields={{
                            walletId: s.wallet.id,
                            accountId: a.id,
                            archived: a.archivedAt ? "false" : "true",
                          }}
                          label={`${a.archivedAt ? "Desarquivar" : "Arquivar"} ${a.name}`}
                          confirm={a.archivedAt ? undefined : `Arquivar ${a.name}?`}
                          confirmLabel="Sim, arquivar"
                        >
                          {a.archivedAt ? "Desarquivar" : "Arquivar"}
                        </ActionButton>
                      ) : null}
                    </div>
                    {a.cards.length > 0 ? (
                      <ul className="mt-2 flex flex-col gap-1 pl-4 text-sm">
                        {a.cards.map((c) => (
                          <li
                            key={c.id}
                            className="flex flex-wrap items-center justify-between gap-2"
                          >
                            <span className="break-words">
                              {c.nickname} · {c.brand} final {c.lastFour} ·{" "}
                              {CARD_FORM_LABEL[c.form]}
                              {c.isAdditional ? " · adicional" : ""}
                              {c.holder ? ` · ${c.holder.name}` : ""}
                              {c.archivedAt ? " (arquivado)" : ""}
                            </span>
                            {s.canManage ? (
                              <ActionButton
                                action={setCardArchivedAction}
                                fields={{
                                  walletId: s.wallet.id,
                                  cardId: c.id,
                                  archived: c.archivedAt ? "false" : "true",
                                }}
                                label={`${c.archivedAt ? "Desarquivar" : "Arquivar"} o cartão ${c.nickname}`}
                                variant="ghost"
                              >
                                {c.archivedAt ? "Desarquivar" : "Arquivar"}
                              </ActionButton>
                            ) : null}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                    {s.canManage &&
                    !a.archivedAt &&
                    (a.kind === "CREDIT_CARD" || a.kind === "MEAL_VOUCHER") ? (
                      <details className="mt-2 pl-4">
                        <summary className="focus-visible:ring-ring cursor-pointer rounded text-sm font-medium outline-none focus-visible:ring-3">
                          Novo cartão em {a.name}
                        </summary>
                        <CardForm walletId={s.wallet.id} accountId={a.id} people={people} me={me} />
                      </details>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </section>
        ))}
        {manageable.length > 0 ? (
          <section aria-labelledby="nova-conta" className={SECTION}>
            <h2 id="nova-conta" className="mb-3 font-semibold">
              Nova conta
            </h2>
            <AccountForm wallets={manageable} />
          </section>
        ) : null}
      </div>
    </>
  );
}
