import type { Metadata } from "next";
import Link from "next/link";
import { ActionButton } from "@/components/feedback/action-button";
import { PageHeader } from "@/components/layout/page-header";
import { AmountText } from "@/components/money/amount-text";
import { confirmTransactionAction } from "@/features/transactions/server/actions";
import { getTransactionPage } from "@/features/transactions/server/queries";
import { DeleteTransaction } from "@/features/transactions/ui/delete-transaction";
import { TransactionForm } from "@/features/transactions/ui/transaction-form";
import { requireUser } from "@/lib/auth/session";
import { formatDate, formatDateTime } from "@/lib/dates";
import { CATEGORIZED_BY_LABEL, METHOD_LABEL, STATUS_LABEL } from "@/lib/labels";
import { TEXT_LINK } from "@/lib/styles";

export const metadata: Metadata = { title: "Lançamento" };

const SECTION = "bg-card rounded-2xl border p-5 md:p-6";

// Detalhe de um lançamento (M07). O id vem da URL: a primeira coisa depois da sessão é o
// crachá do lançamento (a decisão é a da carteira dele). Lançamento de outra pessoa, que não
// existe ou com id fora do formato: a mesma página 404 (ADR-006).
export default async function TransactionPage({
  params,
}: PageProps<"/lancamentos/[transactionId]">) {
  const session = await requireUser();
  const { transactionId } = await params;
  const { transaction: t, form } = await getTransactionPage(session, transactionId);
  const kind = t.amount < 0n ? "expense" : "income";

  return (
    <>
      <PageHeader
        title={t.description}
        description={`${formatDate(new Date(`${t.occurredOn}T12:00:00Z`))} · ${t.wallet.name}`}
      />
      <div className="flex max-w-md flex-col gap-6">
        <section aria-labelledby="resumo" className={SECTION}>
          <h2 id="resumo" className="sr-only">
            Resumo
          </h2>
          <AmountText cents={t.amount} className="text-2xl" />
          <dl className="text-muted-foreground mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            <dt>Situação</dt>
            <dd>{STATUS_LABEL[t.status]}</dd>
            <dt>Forma</dt>
            <dd>{METHOD_LABEL[t.method]}</dd>
            <dt>Conta</dt>
            <dd className="break-words">{t.account.name}</dd>
            <dt>Categoria</dt>
            <dd className="break-words">
              {t.transferId
                ? "Transferência (sem categoria)"
                : t.category
                  ? `${t.category.name}${t.categorizedBy ? ` (${CATEGORIZED_BY_LABEL[t.categorizedBy]})` : ""}`
                  : "Sem categoria"}
            </dd>
            <dt>Lançado por</dt>
            <dd className="break-words">
              {t.createdBy?.name ?? (t.source === "RECURRENCE" ? "recorrência" : "importação")} em{" "}
              {formatDateTime(t.createdAt)}
            </dd>
          </dl>
          {t.status === "SCHEDULED" && t.canEdit ? (
            <div className="mt-4">
              <ActionButton
                action={confirmTransactionAction}
                fields={{ transactionId: t.id }}
                variant="default"
              >
                Confirmar: aconteceu
              </ActionButton>
            </div>
          ) : null}
        </section>

        {form ? (
          <section aria-labelledby="editar" className={SECTION}>
            <h2 id="editar" className="mb-4 font-semibold">
              Editar
            </h2>
            <TransactionForm
              options={form}
              existing={{
                id: t.id,
                kind,
                cents: kind === "expense" ? -t.amount : t.amount,
                description: t.description,
                occurredOn: t.occurredOn,
                walletId: t.walletId,
                accountId: t.accountId,
                categoryId: t.categoryId,
                method: t.method,
                cardId: t.cardId,
                notes: t.notes,
              }}
            />
          </section>
        ) : (
          <p className="text-muted-foreground text-sm">
            {t.transferId
              ? "Transferência não se edita: exclua (dá para desfazer) e lance de novo."
              : "Você só pode ver este lançamento: seu papel nesta carteira é leitor."}
          </p>
        )}

        {t.canEdit ? (
          <section aria-labelledby="excluir" className={SECTION}>
            <h2 id="excluir" className="mb-3 font-semibold">
              Excluir
            </h2>
            <DeleteTransaction id={t.id} label={t.description} />
          </section>
        ) : null}

        <Link href="/lancamentos" className={TEXT_LINK}>
          Voltar para a lista
        </Link>
      </div>
    </>
  );
}
