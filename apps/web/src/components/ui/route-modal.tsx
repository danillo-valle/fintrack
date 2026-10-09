"use client";

import { createContext, useContext, useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";

type Props = {
  title: string;
  /** Uma linha embaixo do título. Pode ser um componente (o ambiente do lançamento, por exemplo). */
  description?: React.ReactNode;
  /** Seletor do campo que recebe o foco ao abrir (por exemplo "#modal-amount"). */
  initialFocus?: string;
  /** Rodapé fixo (os botões). Fica sempre à vista, mesmo quando o meio rola. */
  footer?: React.ReactNode;
  children: React.ReactNode;
};

const ModalContext = createContext<{ close: () => void } | null>(null);

/** Fechar o modal de dentro dele (o botão Cancelar, por exemplo). */
export function useRouteModal() {
  const value = useContext(ModalContext);
  if (!value) throw new Error("useRouteModal fora do RouteModal");
  return value;
}

// Modal de rota (Visual C, ADR-008; layout do M07.3). Abre por cima da página atual quando a
// navegação vem de um link do app (rota interceptada); recarregar ou abrir o link direto mostra a
// página inteira.
//
// <dialog> nativo com showModal(): o navegador prende o foco dentro, deixa o resto da página
// inerte e fecha com Esc, sem biblioteca. Três partes: cabeçalho, meio e rodapé. Só o meio rola,
// e só quando a tela é baixa demais (no celular, quase sempre; no computador, a partir de 900 px de
// altura, nunca). No celular, um painel que sobe da base; a partir de 768 px, centralizado.
// Fechar = voltar no histórico (a URL volta junto).
export function RouteModal({ title, description, initialFocus, footer, children }: Props) {
  const router = useRouter();
  const ref = useRef<HTMLDialogElement>(null);
  // A rota paralela guarda o último conteúdo quando se navega para outro endereço SEM fechar
  // o modal (um link dentro dele). Por isso o modal só aparece no endereço em que foi aberto.
  const pathname = usePathname();
  const [openedAt] = useState(pathname);
  const visible = pathname === openedAt;

  useEffect(() => {
    const dialog = ref.current;
    if (!visible || !dialog || dialog.open) return;
    dialog.showModal();
    // showModal() foca o primeiro botão (Fechar); o lançamento rápido começa pelo valor
    const target = initialFocus ? dialog.querySelector<HTMLElement>(initialFocus) : null;
    target?.focus();
  }, [visible, initialFocus]);

  if (!visible) return null;
  const close = () => router.back();

  return (
    <ModalContext value={{ close }}>
      <dialog
        ref={ref}
        aria-labelledby="modal-titulo"
        aria-describedby={description ? "modal-descricao" : undefined}
        // Esc: o navegador fecharia sozinho; aqui a rota volta, e o React tira o modal
        onCancel={(event) => {
          event.preventDefault();
          close();
        }}
        // Clique no véu (fora do painel) também fecha
        onClick={(event) => {
          if (event.target === event.currentTarget) close();
        }}
        className="route-modal glass-panel text-foreground fixed inset-x-0 top-10 bottom-0 m-0 h-auto max-h-none w-full max-w-none flex-col overflow-hidden rounded-t-[1.625rem] border p-0 shadow-2xl open:flex md:inset-0 md:m-auto md:h-fit md:max-h-[calc(100dvh-2rem)] md:max-w-[40rem] md:rounded-3xl"
      >
        <div className="flex shrink-0 flex-col gap-2.5 px-4 pt-2.5 md:px-[1.625rem] md:pt-6">
          <span aria-hidden className="bg-border mx-auto h-1.5 w-10 rounded-full md:hidden" />
          <div className="flex items-start justify-between gap-4">
            <div className="flex flex-col gap-0.5">
              <h2
                id="modal-titulo"
                className="text-xl font-extrabold tracking-tight md:text-[1.375rem]"
              >
                {title}
              </h2>
              {description ? (
                <p id="modal-descricao" className="text-muted-foreground text-sm">
                  {description}
                </p>
              ) : null}
            </div>
            <Button
              type="button"
              variant="outline"
              size="icon-lg"
              aria-label="Fechar"
              className="size-11 shrink-0 rounded-xl md:size-10"
              onClick={close}
            >
              <X aria-hidden className="size-5" />
            </Button>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pt-3 pb-4 md:px-[1.625rem] md:pt-4">
          {children}
        </div>
        {footer ? (
          <div className="shrink-0 border-t px-4 pt-3 pb-[calc(1.625rem+env(safe-area-inset-bottom))] md:border-t-0 md:px-[1.625rem] md:pt-0 md:pb-6">
            {footer}
          </div>
        ) : null}
      </dialog>
    </ModalContext>
  );
}
