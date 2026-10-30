"use client";

// Quem está na sessão (M13.1, pranchas L-Sessao e L-CelSessao). Antes, só dava para saber quem
// estava logado entrando em Ajustes; agora as iniciais (DV, NV) ficam à vista o tempo todo, na cor
// da pessoa no "Pago por", e um toque mostra o nome, o e-mail e o Sair.
//
//   "sidebar": no pé da barra lateral do computador. Aberta, as iniciais, o nome e o lar; recolhida,
//              só o círculo (o nome vira dica). A lista abre em cima do botão (ou ao lado, recolhida),
//              fecha com Esc e com clique fora.
//   "header":  no topo do celular, à direita. Abre um painel que sobe da base (<dialog> nativo:
//              o foco fica preso dentro, Esc fecha, o resto da página fica inerte).
import { useId, useRef, useState } from "react";
import Link from "next/link";
import { ChevronUp, LogOut, Settings, ShieldCheck } from "lucide-react";
import { SidebarLabel } from "@/components/layout/sidebar/sidebar-label";
import { MENU_ITEM, MenuSeparator } from "@/components/visual/actions-menu";
import { PersonAvatar } from "@/components/visual/person-avatar";
import { usePopover } from "@/components/visual/use-popover";
import type { SessionIdentity } from "@/features/households/server/queries";
import { cn } from "@/lib/utils";
import { useSignOut } from "./sign-out-button";

/** Quem está na sessão, como a casca lê no servidor (getSessionIdentity). */
export type UserMenuIdentity = SessionIdentity;

function Who({ who, size }: { who: UserMenuIdentity; size: "md" | "lg" }) {
  return (
    <div className="flex min-w-0 items-center gap-3 px-2 pt-1.5 pb-3">
      <PersonAvatar initials={who.initials} tone={who.tone} size={size} />
      <div className="flex min-w-0 flex-col">
        <strong className="truncate text-[0.9375rem]">{who.name}</strong>
        <span className="text-muted-foreground truncate text-[0.8125rem]">
          {who.email}
          {who.household ? ` · ${who.household}` : ""}
        </span>
      </div>
    </div>
  );
}

function Items({ onNavigate }: { onNavigate: () => void }) {
  const { pending, signOut } = useSignOut();
  return (
    <>
      <MenuSeparator />
      <Link href="/ajustes/seguranca" onClick={onNavigate} className={MENU_ITEM}>
        <ShieldCheck aria-hidden />
        <span className="flex-1">Senha, 2FA e sessões</span>
      </Link>
      <Link href="/ajustes" onClick={onNavigate} className={MENU_ITEM}>
        <Settings aria-hidden />
        <span className="flex-1">Ajustes</span>
      </Link>
      <MenuSeparator />
      <button
        type="button"
        onClick={signOut}
        disabled={pending}
        className={cn(MENU_ITEM, "text-destructive hover:bg-destructive/10 disabled:opacity-60")}
      >
        <LogOut aria-hidden />
        {pending ? "Saindo…" : "Sair"}
      </button>
    </>
  );
}

export function UserMenu({
  who,
  placement,
}: {
  who: UserMenuIdentity;
  placement: "sidebar" | "header";
}) {
  return placement === "sidebar" ? <SidebarUserMenu who={who} /> : <HeaderUserMenu who={who} />;
}

function SidebarUserMenu({ who }: { who: UserMenuIdentity }) {
  const { open, toggle, dismiss, panelId, rootRef, triggerRef } = usePopover();
  return (
    <div ref={rootRef} className="collapsed:w-auto relative w-full">
      <button
        ref={triggerRef}
        type="button"
        aria-label={`Sua conta: ${who.name}`}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={toggle}
        className="group/item border-sidebar-border text-sidebar-foreground focus-visible:ring-sidebar-ring aria-expanded:border-highlight/45 aria-expanded:bg-highlight/10 collapsed:mx-auto collapsed:size-12 collapsed:justify-center collapsed:rounded-full collapsed:p-0 relative flex h-14 w-full items-center gap-2.5 rounded-[0.875rem] border bg-white/4 px-2.5 text-left outline-none hover:bg-white/8 focus-visible:ring-3"
      >
        <PersonAvatar initials={who.initials} tone={who.tone} />
        {/* Aberto: o nome e o lar ao lado. Recolhido: só o círculo, e o nome vira dica */}
        <span className="collapsed:hidden flex min-w-0 flex-1 flex-col leading-tight">
          <strong className="truncate text-[0.90625rem]">{who.name}</strong>
          {who.household ? (
            <span className="text-sidebar-muted-foreground truncate text-[0.78125rem]">
              {who.household}
            </span>
          ) : null}
        </span>
        <ChevronUp aria-hidden className="collapsed:hidden size-4 shrink-0" />
        <span aria-hidden className="collapsed:contents hidden">
          <SidebarLabel>{who.name}</SidebarLabel>
        </span>
      </button>
      <div
        id={panelId}
        role="group"
        aria-label="Sua conta"
        hidden={!open}
        className="bg-card text-card-foreground collapsed:bottom-0 collapsed:left-full collapsed:ml-3 absolute bottom-full left-0 z-50 mb-2 flex w-[16.5rem] flex-col rounded-2xl border p-1.5 shadow-[0_22px_48px_rgba(0,0,0,0.35)]"
      >
        <Who who={who} size="md" />
        <Items onNavigate={dismiss} />
      </div>
    </div>
  );
}

function HeaderUserMenu({ who }: { who: UserMenuIdentity }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const titleId = useId();

  function show() {
    dialog.current?.showModal();
    setOpen(true);
  }
  function close() {
    dialog.current?.close();
  }

  return (
    <>
      <button
        type="button"
        aria-label={`Sua conta: ${who.name}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={show}
        className="focus-visible:ring-ring aria-expanded:ring-primary inline-flex size-11 items-center justify-center rounded-full outline-none focus-visible:ring-3 aria-expanded:ring-2"
      >
        <PersonAvatar initials={who.initials} tone={who.tone} />
      </button>
      <dialog
        ref={dialog}
        aria-labelledby={titleId}
        onClose={() => setOpen(false)}
        onClick={(event) => {
          // Toque fora do painel (no fundo escurecido) fecha
          if (event.target === dialog.current) close();
        }}
        className="bg-card text-card-foreground backdrop:bg-foreground/45 fixed inset-x-0 top-auto bottom-0 m-0 w-full max-w-none rounded-t-[1.625rem] border-t p-0 pb-[max(1.5rem,env(safe-area-inset-bottom))]"
      >
        <div className="flex flex-col gap-1.5 px-4 pt-2.5">
          <span aria-hidden className="bg-border mx-auto mb-2.5 h-[5px] w-10 rounded-full" />
          <h2 id={titleId} className="sr-only">
            Sua conta
          </h2>
          <Who who={who} size="lg" />
          <Items onNavigate={close} />
          <button
            type="button"
            onClick={close}
            className={cn(MENU_ITEM, "text-muted-foreground mt-1 justify-center")}
          >
            Fechar
          </button>
        </div>
      </dialog>
    </>
  );
}
