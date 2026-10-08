"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";

type Props = {
  title: string;
  description?: string;
  /** Seletor do campo que recebe o foco ao abrir (por exemplo "#modal-amount"). */
  initialFocus?: string;
  children: React.ReactNode;
};

// Modal de rota (Visual C, ADR-008). Abre por cima da página atual quando a navegação vem de um
// link do app (rota interceptada); recarregar ou abrir o link direto mostra a página inteira.
//
// Usa o <dialog> nativo com showModal(): o navegador prende o foco dentro, deixa o resto da
// página inerte e fecha com Esc, sem biblioteca. No celular, vira um painel que sobe da base;
// a partir de 768px, um modal centralizado. Fechar = voltar no histórico (a URL volta junto).
export function RouteModal({ title, description, initialFocus, children }: Props) {
  const router = useRouter();
  const ref = useRef<HTMLDialogElement>(null);
  // A rota paralela guarda o último conteúdo quando se navega para outro endereço SEM fechar
  // o modal (um link dentro dele). Por isso o modal só aparece no endereço em que foi aberto.
  // (Uma rota "pega-tudo" no @modal resolveria, mas faria todo endereço inexistente responder
  // 200 em vez de 404.)
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

  return (
    <dialog
      ref={ref}
      aria-labelledby="modal-titulo"
      aria-describedby={description ? "modal-descricao" : undefined}
      // Esc: o navegador fecharia sozinho; aqui a rota volta, e o React tira o modal
      onCancel={(event) => {
        event.preventDefault();
        router.back();
      }}
      // Clique no véu (fora do painel) também fecha
      onClick={(event) => {
        if (event.target === event.currentTarget) router.back();
      }}
      className="route-modal glass-panel text-foreground fixed inset-x-0 top-auto bottom-0 m-0 max-h-[92dvh] w-full max-w-none overflow-y-auto rounded-t-3xl border p-0 shadow-2xl md:inset-0 md:m-auto md:h-fit md:max-w-xl md:rounded-3xl"
    >
      <div className="flex flex-col gap-5 p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] md:p-7">
        <span aria-hidden className="bg-border mx-auto -mt-2 h-1.5 w-10 rounded-full md:hidden" />
        <div className="flex items-start justify-between gap-4">
          <div className="flex flex-col gap-1">
            <h2 id="modal-titulo" className="text-xl font-bold tracking-tight">
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
            className="size-11 shrink-0 rounded-xl"
            onClick={() => router.back()}
          >
            <X aria-hidden className="size-5" />
          </Button>
        </div>
        {children}
      </div>
    </dialog>
  );
}
