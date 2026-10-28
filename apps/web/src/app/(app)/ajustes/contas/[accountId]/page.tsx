import type { Metadata } from "next";
import Link from "next/link";
import { CheckCircle2, CreditCard, Plus } from "lucide-react";
import { ActionButton } from "@/components/feedback/action-button";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { IconTile } from "@/components/visual/icon-tile";
import { setCardArchivedAction } from "@/features/accounts/server/actions";
import { getCardFormPage } from "@/features/accounts/server/queries";
import { getAccountCardsPage } from "@/features/bank/server/review";
import { FinalForm } from "@/features/bank/ui/review/final-form";
import { notFoundOnDenied } from "@/lib/access";
import { requireUser } from "@/lib/auth/session";
import { ACCOUNT_KIND_LABEL } from "@/lib/labels";

export const metadata: Metadata = { title: "Conta" };

// Uma conta em Ajustes › Contas (M09.2, prancha E2-Finais): os cartões da fatura e, quando o
// banco mandou compras de um final que não está cadastrado (um adicional novo), o formulário que
// cadastra o cartão e leva essas compras para o portador e o ambiente certos.
export default async function AccountCardsPage({
  params,
  searchParams,
}: PageProps<"/ajustes/contas/[accountId]">) {
  const session = await requireUser(); // toda página do app começa conferindo a sessão
  const { accountId } = await params;
  const moved = Number.parseInt(String((await searchParams).movidos ?? ""), 10);
  const page = await getAccountCardsPage(session, accountId).catch(notFoundOnDenied);
  const { account } = page;
  const credit = account.kind === "CREDIT_CARD";
  const description = [
    ACCOUNT_KIND_LABEL[account.kind],
    page.institution ? `ligado ao ${page.institution}` : null,
    account.closingDay ? `fecha dia ${account.closingDay}, vence dia ${account.dueDay}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const active = account.cards.filter((c) => !c.archivedAt);
  // Adicionar cartão (M12.3a): só quem é dono da carteira, numa conta de cartão ou de vale ativa
  const canAddCard = (await getCardFormPage(session, accountId)) !== null;

  return (
    <>
      <PageHeader
        help="contas-e-cartoes"
        crumb={{ href: "/ajustes/contas", label: "Ajustes · Contas" }}
        title={account.name}
        description={description}
        actions={
          canAddCard ? (
            <Button asChild variant="outline" className="h-11 gap-2 rounded-xl px-4 font-bold">
              <Link href={`/ajustes/contas/${account.id}/cartao?volta=conta`}>
                <Plus aria-hidden />
                Adicionar cartão
              </Link>
            </Button>
          ) : null
        }
      />
      {Number.isInteger(moved) && moved >= 0 ? (
        <p role="status" className="text-income mb-4 flex items-center gap-2 text-sm font-semibold">
          <CheckCircle2 aria-hidden className="size-[1.125rem]" />
          Cartão cadastrado.{" "}
          {moved === 0
            ? ""
            : moved === 1
              ? "1 recebido foi para ele."
              : `${moved} recebidos foram para ele.`}
        </p>
      ) : null}
      <section
        aria-labelledby="cartoes"
        className="bg-card flex max-w-3xl flex-col gap-3.5 rounded-[1.125rem] border px-4 py-4 md:px-[1.375rem] md:py-[1.125rem]"
      >
        <h2 id="cartoes" className="text-lg font-extrabold md:text-xl">
          {credit ? "Cartões desta fatura" : "Cartões"}
        </h2>
        {account.cards.length === 0 ? (
          <p className="text-muted-foreground text-sm">Nenhum cartão cadastrado.</p>
        ) : (
          <ul className="divide-y">
            {account.cards.map((c) => (
              <li
                key={c.id}
                className="grid grid-cols-[2.125rem_minmax(0,1fr)_auto] items-center gap-3 py-3"
              >
                <IconTile
                  tone="neutral"
                  icon={CreditCard}
                  size="sm"
                  className="size-[2.125rem] rounded-[0.625rem]"
                />
                <span className="flex min-w-0 flex-col">
                  <strong className="text-[0.9375rem] break-words">
                    {c.nickname}
                    {c.archivedAt ? (
                      <span className="text-muted-foreground font-normal"> (arquivado)</span>
                    ) : null}
                  </strong>
                  <span className="text-muted-foreground text-[0.8125rem]">
                    <span className="tabular">final {c.lastFour}</span>
                    {c.holder ? ` · ${c.holder.name}` : ""} ·{" "}
                    {c.isAdditional ? "adicional" : "titular"}
                    {c.importWallet ? ` · compras em: ${c.importWallet.name}` : ""}
                  </span>
                </span>
                {page.canManage ? (
                  <ActionButton
                    action={setCardArchivedAction}
                    fields={{
                      walletId: account.walletId,
                      cardId: c.id,
                      archived: c.archivedAt ? "false" : "true",
                    }}
                    label={`${c.archivedAt ? "Desarquivar" : "Arquivar"} o cartão ${c.nickname}`}
                    variant="outline"
                  >
                    {c.archivedAt ? "Desarquivar" : "Arquivar"}
                  </ActionButton>
                ) : (
                  <span />
                )}
              </li>
            ))}
          </ul>
        )}
        {page.canManage
          ? page.finals.map((f) => (
              <FinalForm
                key={f.lastFour}
                accountId={account.id}
                lastFour={f.lastFour}
                count={f.count}
                people={page.people}
                defaultHolder={
                  // O portador mais provável de um final novo: quem ainda não tem cartão na conta
                  page.people.find((p) => !active.some((c) => c.holderId === p.userId))?.userId ??
                  page.me
                }
              />
            ))
          : null}
      </section>
    </>
  );
}
