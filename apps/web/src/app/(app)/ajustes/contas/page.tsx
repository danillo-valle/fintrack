import type { Metadata } from "next";
import Link from "next/link";
import {
  Archive,
  ArchiveRestore,
  Banknote,
  CreditCard,
  Landmark,
  PencilLine,
  PiggyBank,
  Plus,
  UtensilsCrossed,
  type LucideIcon,
} from "lucide-react";
import { ActionButton } from "@/components/feedback/action-button";
import { EmptyState } from "@/components/feedback/empty-state";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { IconTile, type Tone } from "@/components/visual/icon-tile";
import { ActionsMenu, MENU_ITEM } from "@/components/visual/actions-menu";
import type { HouseholdPerson } from "@fintrack/core";
import { cardView } from "@/features/accounts/card-view";
import { setAccountArchivedAction } from "@/features/accounts/server/actions";
import { CARD_ACCOUNT_KINDS, getAccountsPage } from "@/features/accounts/server/queries";
import { CardTile } from "@/features/accounts/ui/card-tile";
import { CreatedNoticeBanner, type CreatedNotice } from "@/features/accounts/ui/created-notice";
import { requireUser } from "@/lib/auth/session";
import { ACCOUNT_KIND_LABEL } from "@/lib/labels";
import { TEXT_LINK } from "@/lib/styles";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Contas e cartões" };

// Ícone e cor de cada tipo de conta (M07.2): o tipo também está escrito na linha
const KIND_ICON: Record<string, { icon: LucideIcon; tone: Tone }> = {
  CHECKING: { icon: Landmark, tone: 1 },
  SAVINGS: { icon: PiggyBank, tone: 2 },
  CREDIT_CARD: { icon: CreditCard, tone: 3 },
  MEAL_VOUCHER: { icon: UtensilsCrossed, tone: 4 },
  CASH: { icon: Banknote, tone: 5 },
};

// Contas e cartões (M07), por carteira. Quem é dono da carteira cria e arquiva; os outros veem.
// M12.3a (prancha J-Contas): "Nova conta" no cabeçalho e "Adicionar cartão" em cada conta de
// cartão ou de vale, os dois em modal; depois de criar, o aviso no topo e a linha marcada.
// M13.1 (prancha L-Contas): cada cartão vira uma peça com quem usa, e as ações vão para o "⋯".
export default async function AccountsPage({ searchParams }: PageProps<"/ajustes/contas">) {
  const session = await requireUser();
  const params = await searchParams;
  const { sections, people } = await getAccountsPage(session);
  const canCreate = sections.some((s) => s.canManage);
  const notice = noticeFrom(sections, params);
  const highlighted = notice?.accountId ?? null;

  return (
    <>
      <PageHeader
        help="contas-e-cartoes"
        title="Contas e cartões"
        description="De onde o dinheiro sai e quem usa cada cartão"
        actions={
          canCreate ? (
            <Button asChild className="h-11 gap-2 rounded-xl px-[1.125rem] font-bold">
              <Link href="/ajustes/contas/nova">
                <Plus aria-hidden />
                Nova conta
              </Link>
            </Button>
          ) : null
        }
      />
      {notice ? <CreatedNoticeBanner notice={notice} /> : null}
      <div className="flex flex-col gap-7">
        {sections.length === 0 ? (
          <EmptyState
            icon={Landmark}
            title="Você ainda não tem um lar"
            description="Crie o seu lar em Carteiras primeiro."
          />
        ) : null}
        {sections.map((s) => (
          <section
            key={s.wallet.id}
            aria-labelledby={`w-${s.wallet.id}`}
            className="flex min-w-0 flex-col gap-3"
          >
            <h2 id={`w-${s.wallet.id}`} className="text-xl font-extrabold break-words">
              {s.wallet.name}
            </h2>
            {s.accounts.length === 0 ? (
              <p className="text-muted-foreground rounded-2xl border border-dashed p-4 text-sm">
                Nenhuma conta nesta carteira.
              </p>
            ) : (
              <ul className="flex flex-col gap-3">
                {s.accounts.map((a) => (
                  <AccountBlock
                    key={a.id}
                    account={a}
                    walletId={s.wallet.id}
                    canManage={s.canManage}
                    highlighted={a.id === highlighted}
                    people={people}
                  />
                ))}
              </ul>
            )}
          </section>
        ))}
      </div>
    </>
  );
}

type Sections = Awaited<ReturnType<typeof getAccountsPage>>["sections"];
type AccountRow = Sections[number]["accounts"][number];

/**
 * Uma conta (M13.1, prancha L-Contas): o cabeçalho com o tipo, o ciclo e o banco; "Adicionar
 * cartão" e o menu "⋯" (Arquivar) para quem gere; embaixo, os cartões como peças.
 */
function AccountBlock({
  account: a,
  walletId,
  canManage,
  highlighted,
  people,
}: {
  account: AccountRow;
  walletId: string;
  canManage: boolean;
  highlighted: boolean;
  people: HouseholdPerson[];
}) {
  const acceptsCards = CARD_ACCOUNT_KINDS.has(a.kind);
  const kind = KIND_ICON[a.kind] ?? { icon: Landmark, tone: 1 as Tone };
  return (
    <li
      data-nova={highlighted ? "true" : undefined}
      className={cn(
        "bg-card flex min-w-0 flex-col gap-3.5 rounded-[1.125rem] border p-4 md:p-[1.125rem]",
        highlighted && "ring-primary bg-primary/5 ring-2",
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-[1_1_16rem] items-center gap-3">
          <IconTile tone={a.archivedAt ? "neutral" : kind.tone} icon={kind.icon} size="md" />
          <div className="min-w-0">
            <p className="text-[1.0625rem] font-bold break-words">
              <Link href={`/ajustes/contas/${a.id}`} className={TEXT_LINK}>
                {a.name}
              </Link>
              {a.archivedAt ? (
                <span className="text-muted-foreground font-normal"> (arquivada)</span>
              ) : null}
            </p>
            <p className="text-muted-foreground text-sm">
              {ACCOUNT_KIND_LABEL[a.kind]}
              {a.closingDay ? ` · fecha dia ${a.closingDay}, vence dia ${a.dueDay}` : ""}
              {a.institution ? ` · ${a.institution}` : ""}
            </p>
          </div>
        </div>
        {canManage ? (
          <div className="flex items-center gap-2">
            {!a.archivedAt && acceptsCards ? (
              <Button asChild variant="outline" className="h-10 gap-1.5 rounded-xl font-bold">
                <Link
                  href={`/ajustes/contas/${a.id}/cartao`}
                  aria-label={`Adicionar cartão em ${a.name}`}
                >
                  <Plus aria-hidden />
                  Adicionar cartão
                </Link>
              </Button>
            ) : null}
            <ActionsMenu label={`Opções da conta ${a.name}`}>
              {a.archivedAt ? null : (
                <Link
                  href={`/ajustes/contas/${a.id}/editar`}
                  scroll={false}
                  aria-label={`Editar a conta ${a.name}`}
                  className={MENU_ITEM}
                >
                  <PencilLine aria-hidden />
                  Editar conta
                </Link>
              )}
              <ActionButton
                action={setAccountArchivedAction}
                fields={{ walletId, accountId: a.id, archived: a.archivedAt ? "false" : "true" }}
                label={`${a.archivedAt ? "Desarquivar" : "Arquivar"} ${a.name}`}
                variant="ghost"
                confirm={a.archivedAt ? undefined : `Arquivar ${a.name}?`}
                confirmLabel="Sim, arquivar"
                className={cn(
                  MENU_ITEM,
                  !a.archivedAt && "text-destructive hover:text-destructive",
                )}
              >
                {a.archivedAt ? <ArchiveRestore aria-hidden /> : <Archive aria-hidden />}
                {a.archivedAt ? "Desarquivar a conta" : "Arquivar a conta"}
              </ActionButton>
            </ActionsMenu>
          </div>
        ) : null}
      </div>
      {canManage && !a.archivedAt && acceptsCards && a.cards.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          Ainda sem cartão. Cadastre o físico e os virtuais para o bot e a fatura saberem de quem é
          cada compra.
        </p>
      ) : null}
      {a.cards.length > 0 ? (
        <ul aria-label={`Cartões de ${a.name}`} className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {a.cards.map((c) => (
            <CardTile
              key={c.id}
              card={cardView(c, a.holderId, people)}
              walletId={walletId}
              accountId={a.id}
              canManage={canManage}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

/**
 * O aviso do topo, a partir de ?criada=<conta>, ?cartao=<cartão>&movidos=N ou (M13.1)
 * ?editado=<cartão>&movidos=N, e (M13.2) ?editada=<conta> (as actions voltam com eles). Só vale para uma conta ou um cartão que a pessoa vê nesta tela: um id de fora não
 * mostra nada (nem diz que existe).
 */
function noticeFrom(
  sections: Sections,
  params: Record<string, string | string[] | undefined>,
): CreatedNotice | null {
  const created = typeof params.criada === "string" ? params.criada : null;
  const cardId = typeof params.cartao === "string" ? params.cartao : null;
  const editedId = typeof params.editado === "string" ? params.editado : null;
  const editedAccount = typeof params.editada === "string" ? params.editada : null;
  const moved = Number.parseInt(String(params.movidos ?? "0"), 10);
  for (const s of sections) {
    for (const a of s.accounts) {
      if (created && a.id === created) {
        return {
          kind: "account",
          accountId: a.id,
          name: a.name,
          wallet: s.wallet.name,
          acceptsCards: s.canManage && !a.archivedAt && CARD_ACCOUNT_KINDS.has(a.kind),
        };
      }
      if (editedAccount && a.id === editedAccount) {
        return { kind: "account-updated", accountId: a.id, name: a.name };
      }
      const edited = editedId ? a.cards.find((c) => c.id === editedId) : undefined;
      if (edited) {
        return {
          kind: "card-updated",
          accountId: a.id,
          name: edited.nickname,
          moved: Number.isInteger(moved) && moved > 0 ? moved : 0,
        };
      }
      const card = cardId ? a.cards.find((c) => c.id === cardId) : undefined;
      if (card) {
        return {
          kind: "card",
          accountId: a.id,
          name: card.nickname,
          account: a.name,
          moved: Number.isInteger(moved) && moved > 0 ? moved : 0,
        };
      }
    }
  }
  return null;
}
