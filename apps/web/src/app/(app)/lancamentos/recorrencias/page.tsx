import type { Metadata } from "next";
import { Repeat } from "lucide-react";
import { ActionButton } from "@/components/feedback/action-button";
import { EmptyState } from "@/components/feedback/empty-state";
import { PageHeader } from "@/components/layout/page-header";
import { AmountText } from "@/components/money/amount-text";
import {
  archiveRecurrenceAction,
  generateRecurrencesAction,
} from "@/features/transactions/server/actions";
import { getRecurrencesPage } from "@/features/transactions/server/queries";
import { RecurrenceForm } from "@/features/transactions/ui/recurrence-form";
import { requireUser } from "@/lib/auth/session";
import { RECURRENCE_KIND_LABEL } from "@/lib/labels";
import { formatMonth } from "@/lib/dates";

export const metadata: Metadata = { title: "Recorrências" };

const SECTION = "rounded-xl border p-5";

// Recorrências (M07): contas fixas, assinaturas e receitas que se repetem. "Lançar as deste mês"
// gera os lançamentos agendados (idempotente: apertar duas vezes não duplica). No M09 a fila
// faz isso sozinha todo dia 1º.
export default async function RecurrencesPage() {
  const session = await requireUser();
  const { recurrences, entry } = await getRecurrencesPage(session);
  const month = entry.defaults.occurredOn.slice(0, 7);
  const canCreate = entry.wallets.length > 0 && entry.accounts.length > 0;
  const active = recurrences.filter((r) => !r.archivedAt);

  return (
    <>
      <PageHeader
        title="Recorrências"
        description="Aluguel, assinaturas, salário: o que se repete todo mês"
      />
      <div className="flex max-w-2xl flex-col gap-6">
        <section aria-labelledby="lancar" className={SECTION}>
          <h2 id="lancar" className="mb-1 font-semibold">
            Lançar as deste mês
          </h2>
          <p className="text-muted-foreground mb-3 text-sm">
            Cria um lançamento agendado para cada recorrência ativa em{" "}
            {formatMonth(new Date(`${month}-15T12:00:00Z`))}. Quando acontecer, confirme no
            lançamento.
          </p>
          <ActionButton action={generateRecurrencesAction} fields={{ month }} variant="default">
            <Repeat aria-hidden />
            Lançar as deste mês
          </ActionButton>
        </section>

        <section aria-labelledby="ativas" className={SECTION}>
          <h2 id="ativas" className="mb-3 font-semibold">
            Recorrências ({active.length} {active.length === 1 ? "ativa" : "ativas"})
          </h2>
          {recurrences.length === 0 ? (
            <EmptyState
              icon={Repeat}
              title="Nenhuma recorrência"
              description="Cadastre abaixo o aluguel, as assinaturas e o salário."
            />
          ) : (
            <ul className="divide-y">
              {recurrences.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <p className="font-medium break-words">
                      {r.description}
                      {r.archivedAt ? (
                        <span className="text-muted-foreground"> (encerrada)</span>
                      ) : null}
                    </p>
                    <p className="text-muted-foreground text-sm break-words">
                      {RECURRENCE_KIND_LABEL[r.kind]} · todo dia {r.dayOfMonth} · {r.account.name} ·{" "}
                      {r.wallet.name}
                      {r.category ? ` · ${r.category.name}` : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <AmountText cents={r.amount} />
                    {r.canEdit && !r.archivedAt ? (
                      <ActionButton
                        action={archiveRecurrenceAction}
                        fields={{ walletId: r.walletId, recurrenceId: r.id }}
                        label={`Encerrar ${r.description}`}
                        confirm={`Encerrar ${r.description}?`}
                        confirmLabel="Sim, encerrar"
                      >
                        Encerrar
                      </ActionButton>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        {canCreate ? (
          <section aria-labelledby="nova" className={SECTION}>
            <h2 id="nova" className="mb-3 font-semibold">
              Nova recorrência
            </h2>
            <RecurrenceForm
              wallets={entry.wallets}
              accounts={entry.accounts}
              categories={entry.categories}
              defaults={entry.defaults}
            />
          </section>
        ) : null}
      </div>
    </>
  );
}
