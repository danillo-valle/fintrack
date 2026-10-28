import type { Metadata } from "next";
import Link from "next/link";
import {
  Banknote,
  CreditCard,
  Landmark,
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
import {
  setAccountArchivedAction,
  setCardArchivedAction,
  setCardSharedPurchasesAction,
} from "@/features/accounts/server/actions";
import { CARD_ACCOUNT_KINDS, getAccountsPage } from "@/features/accounts/server/queries";
import { CreatedNoticeBanner, type CreatedNotice } from "@/features/accounts/ui/created-notice";
import { requireUser } from "@/lib/auth/session";
import { ACCOUNT_KIND_LABEL, CARD_FORM_LABEL } from "@/lib/labels";
import { TEXT_LINK } from "@/lib/styles";

export const metadata: Metadata = { title: "Contas e cartões" };

const SECTION = "bg-card rounded-2xl border p-5 md:p-6";

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
export default async function AccountsPage({ searchParams }: PageProps<"/ajustes/contas">) {
  const session = await requireUser();
  const params = await searchParams;
  const { sections } = await getAccountsPage(session);
  const canCreate = sections.some((s) => s.canManage);
  const notice = noticeFrom(sections, params);
  const highlighted = notice?.accountId ?? null;

  return (
    <>
      <PageHeader
        help="contas-e-cartoes"
        title="Contas e cartões"
        description="De onde o dinheiro sai e para onde entra"
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
      <div className="flex max-w-3xl flex-col gap-6">
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
                  <li
                    key={a.id}
                    data-nova={a.id === highlighted ? "true" : undefined}
                    className={
                      a.id === highlighted
                        ? "ring-primary bg-primary/5 -mx-2 rounded-xl px-2 py-3 ring-2"
                        : "py-3"
                    }
                  >
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="flex min-w-0 items-center gap-3">
                        <IconTile
                          tone={a.archivedAt ? "neutral" : (KIND_ICON[a.kind]?.tone ?? 1)}
                          icon={KIND_ICON[a.kind]?.icon ?? Landmark}
                          size="sm"
                        />
                        <div className="min-w-0">
                          <p className="font-medium break-words">
                            <Link href={`/ajustes/contas/${a.id}`} className={TEXT_LINK}>
                              {a.name}
                            </Link>
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
                      </div>
                      {s.canManage ? (
                        <div className="flex flex-wrap items-center gap-2">
                          {!a.archivedAt && CARD_ACCOUNT_KINDS.has(a.kind) ? (
                            <Button asChild variant="outline" className="h-10 gap-1.5 rounded-xl">
                              <Link
                                href={`/ajustes/contas/${a.id}/cartao`}
                                aria-label={`Adicionar cartão em ${a.name}`}
                              >
                                <Plus aria-hidden />
                                Adicionar cartão
                              </Link>
                            </Button>
                          ) : null}
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
                        </div>
                      ) : null}
                    </div>
                    {s.canManage &&
                    !a.archivedAt &&
                    CARD_ACCOUNT_KINDS.has(a.kind) &&
                    a.cards.length === 0 ? (
                      <p className="text-muted-foreground mt-1.5 pl-11 text-sm">
                        Ainda sem cartão. Cadastre o físico e os virtuais para o bot e a fatura
                        saberem de quem é cada compra.
                      </p>
                    ) : null}
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
                              {c.sharedPurchases ? " · compras conjuntas" : ""}
                              {c.holder ? ` · ${c.holder.name}` : ""}
                              {c.archivedAt ? " (arquivado)" : ""}
                            </span>
                            {s.canManage && !c.archivedAt ? (
                              <ActionButton
                                action={setCardSharedPurchasesAction}
                                fields={{
                                  walletId: s.wallet.id,
                                  cardId: c.id,
                                  sharedPurchases: c.sharedPurchases ? "false" : "true",
                                }}
                                label={`${c.sharedPurchases ? "Desmarcar" : "Marcar"} o cartão ${c.nickname} como de compras conjuntas`}
                                variant="ghost"
                              >
                                {c.sharedPurchases ? "Não é conjunto" : "Compras conjuntas"}
                              </ActionButton>
                            ) : null}
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
                  </li>
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

/**
 * O aviso do topo, a partir de ?criada=<conta> ou ?cartao=<cartão>&movidos=N (as actions voltam
 * com eles). Só vale para uma conta ou um cartão que a pessoa vê nesta tela: um id de fora não
 * mostra nada (nem diz que existe).
 */
function noticeFrom(
  sections: Sections,
  params: Record<string, string | string[] | undefined>,
): CreatedNotice | null {
  const created = typeof params.criada === "string" ? params.criada : null;
  const cardId = typeof params.cartao === "string" ? params.cartao : null;
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
