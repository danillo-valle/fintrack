// Um cartão como peça (M13.1, prancha L-Contas): o desenho do plástico (cheio = físico, tracejado
// = virtual), o apelido e o final, quem usa (iniciais na cor do "Pago por"), as etiquetas e, quando
// não é o ambiente da conta, para onde vão as compras do banco. As ações ficam no menu "⋯".
// Usado na lista de Contas e cartões e na página da conta.
import Link from "next/link";
import { Archive, ArchiveRestore, Home, Pencil, Users, Wallet } from "lucide-react";
import { ActionButton } from "@/components/feedback/action-button";
import { ActionsMenu, MENU_ITEM, MenuSeparator } from "@/components/visual/actions-menu";
import { PersonAvatar } from "@/components/visual/person-avatar";
import { ToneChip } from "@/components/visual/tone-chip";
import { CARD_FORM_LABEL } from "@/lib/labels";
import { cn } from "@/lib/utils";
import type { CardView } from "../card-view";
import { setCardArchivedAction, setCardSharedPurchasesAction } from "../server/actions";

const NEUTRAL_CHIP =
  "bg-muted text-muted-foreground inline-flex h-6 shrink-0 items-center rounded-full px-2.5 text-xs font-bold whitespace-nowrap";

function Plastic({ virtual, tone }: { virtual: boolean; tone: 1 | 2 | 3 | 4 | 5 }) {
  return (
    <span
      aria-hidden
      style={{ "--tone": `var(--chart-${tone})` } as React.CSSProperties}
      className={cn(
        "relative h-8 w-[2.875rem] shrink-0 rounded-[0.4375rem]",
        virtual
          ? "border-[1.5px] border-dashed border-[var(--tone)]"
          : "bg-[var(--tone)] shadow-[inset_0_-10px_0_rgba(0,0,0,0.12)]",
      )}
    >
      <span
        className={cn(
          "absolute rounded-[2px]",
          virtual
            ? "bottom-1.5 left-1.5 h-[3px] w-3.5 bg-[var(--tone)] opacity-60"
            : "top-[9px] left-[7px] h-2 w-2.5 bg-white/75",
        )}
      />
    </span>
  );
}

export function CardTile({
  card,
  walletId,
  accountId,
  canManage,
  back = "contas",
}: {
  card: CardView;
  /** A carteira que gere a conta: o crachá "manage_accounts" das ações */
  walletId: string;
  accountId: string;
  canManage: boolean;
  /** Para onde o Editar volta: a lista ou a página da conta */
  back?: "contas" | "conta";
}) {
  const virtual = card.form !== "PHYSICAL";
  const tone = card.holder?.tone ?? 1;
  return (
    <li
      className={cn(
        "bg-muted/40 flex min-w-0 flex-col gap-3 rounded-2xl p-3.5",
        virtual ? "border-border border-[1.5px] border-dashed" : "border",
        card.archived && "opacity-70",
      )}
    >
      <div className="flex min-w-0 items-center gap-3">
        <Plastic virtual={virtual} tone={card.archived ? 5 : tone} />
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-[0.96875rem] font-bold" title={card.nickname}>
            {card.nickname}
            {card.archived ? (
              <span className="text-muted-foreground font-normal"> (arquivado)</span>
            ) : null}
          </span>
          <span className="text-muted-foreground tabular text-[0.8125rem]">
            {card.brand} ···· {card.lastFour}
          </span>
        </div>
        {canManage ? (
          <ActionsMenu label={`Opções do cartão ${card.nickname}`}>
            {card.archived ? (
              <ActionButton
                action={setCardArchivedAction}
                fields={{ walletId, cardId: card.id, archived: "false" }}
                label={`Desarquivar o cartão ${card.nickname}`}
                variant="ghost"
                className={MENU_ITEM}
              >
                <ArchiveRestore aria-hidden />
                Desarquivar
              </ActionButton>
            ) : (
              <>
                <Link
                  href={`/ajustes/contas/${accountId}/cartao/${card.id}${back === "conta" ? "?volta=conta" : ""}`}
                  className={MENU_ITEM}
                >
                  <Pencil aria-hidden />
                  Editar cartão
                </Link>
                <ActionButton
                  action={setCardSharedPurchasesAction}
                  fields={{
                    walletId,
                    cardId: card.id,
                    sharedPurchases: card.sharedPurchases ? "false" : "true",
                  }}
                  label={`${card.sharedPurchases ? "Desmarcar" : "Marcar"} o cartão ${card.nickname} como de compras conjuntas`}
                  variant="ghost"
                  className={MENU_ITEM}
                >
                  <Users aria-hidden />
                  {card.sharedPurchases
                    ? "Deixar de ser conjunta"
                    : "Marcar como compras conjuntas"}
                </ActionButton>
                <MenuSeparator />
                <ActionButton
                  action={setCardArchivedAction}
                  fields={{ walletId, cardId: card.id, archived: "true" }}
                  label={`Arquivar o cartão ${card.nickname}`}
                  variant="ghost"
                  confirm={`Arquivar ${card.nickname}?`}
                  confirmLabel="Sim, arquivar"
                  className={cn(MENU_ITEM, "text-destructive hover:text-destructive")}
                >
                  <Archive aria-hidden />
                  Arquivar
                </ActionButton>
              </>
            )}
          </ActionsMenu>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {card.holder ? (
          <span className="mr-1 inline-flex items-center gap-1.5 text-[0.84375rem] font-semibold">
            <PersonAvatar initials={card.holder.initials} tone={card.holder.tone} size="sm" />
            <span>
              <span className="sr-only">Quem usa: </span>
              {card.holder.firstName}
            </span>
          </span>
        ) : null}
        <span className={NEUTRAL_CHIP}>{CARD_FORM_LABEL[card.form]}</span>
        {card.isAdditional ? <span className={NEUTRAL_CHIP}>Adicional</span> : null}
        {card.sharedPurchases ? (
          <ToneChip tone={5} icon={Users}>
            Compras conjuntas
          </ToneChip>
        ) : null}
      </div>
      {card.destination ? (
        <p className="text-muted-foreground flex items-center gap-2 border-t border-dashed pt-2.5 text-[0.8125rem]">
          {card.destination.personal ? (
            <Wallet aria-hidden className="size-[0.9375rem] shrink-0" />
          ) : (
            <Home aria-hidden className="size-[0.9375rem] shrink-0" />
          )}
          <span>
            Compras do banco entram em{" "}
            <strong className="text-foreground break-words">{card.destination.name}</strong>
          </span>
        </p>
      ) : null}
    </li>
  );
}
