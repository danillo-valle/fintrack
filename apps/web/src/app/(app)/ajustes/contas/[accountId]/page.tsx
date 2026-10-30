import type { Metadata } from "next";
import Link from "next/link";
import { CheckCircle2, Plus } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { cardView } from "@/features/accounts/card-view";
import { getCardFormPage } from "@/features/accounts/server/queries";
import { CardTile } from "@/features/accounts/ui/card-tile";
import { getAccountCardsPage } from "@/features/bank/server/review";
import { FinalForm } from "@/features/bank/ui/review/final-form";
import { notFoundOnDenied } from "@/lib/access";
import { requireUser } from "@/lib/auth/session";
import { ACCOUNT_KIND_LABEL } from "@/lib/labels";

export const metadata: Metadata = { title: "Conta" };

// Uma conta em Ajustes › Contas (M09.2, prancha E2-Finais): os cartões da fatura e, quando o
// banco mandou compras de um final que não está cadastrado (um adicional novo), o formulário que
// cadastra o cartão e leva essas compras para o portador e o ambiente certos. M13.1: os cartões
// como peças, iguais aos da lista, com o menu "⋯" (Editar, conjunta, Arquivar).
export default async function AccountCardsPage({
  params,
  searchParams,
}: PageProps<"/ajustes/contas/[accountId]">) {
  const session = await requireUser(); // toda página do app começa conferindo a sessão
  const { accountId } = await params;
  const query = await searchParams;
  const moved = Number.parseInt(String(query.movidos ?? ""), 10);
  // M13.1: voltou do Editar cartão (?editado=<cartão>), e não do Adicionar
  const edited = typeof query.editado === "string";
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
          {edited ? "Cartão atualizado." : "Cartão cadastrado."}{" "}
          {moved === 0
            ? ""
            : moved === 1
              ? `1 recebido foi para ${edited ? "o novo ambiente" : "ele"}.`
              : `${moved} recebidos foram para ${edited ? "o novo ambiente" : "ele"}.`}
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
          <ul aria-label="Cartões desta conta" className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {account.cards.map((c) => (
              <CardTile
                key={c.id}
                card={cardView(c, account.holderId, page.people)}
                walletId={account.walletId}
                accountId={account.id}
                canManage={page.canManage}
                back="conta"
              />
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
