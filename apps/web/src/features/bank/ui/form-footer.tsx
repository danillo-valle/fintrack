"use client";

// Rodapé dos passos de "Conectar o Meu Pluggy" (M09.1) e do "Confirmar o par" (M09.2):
// Cancelar/Voltar e o botão principal,
// ligado ao formulário pelo atributo form="…" (o rodapé do modal fica fora do <form>, sempre à
// vista mesmo quando o meio rola). Na página inteira, o mesmo rodapé vai embaixo do formulário.
import Link from "next/link";
import { ArrowRight, Check, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useOptionalRouteModal } from "@/components/ui/route-modal";

export function StepFooter({
  formId,
  submitLabel,
  submitIcon,
  backLabel,
  backHref,
  closesModal = false,
}: {
  formId: string;
  submitLabel: string;
  /** Nome do ícone (componente não passa do servidor para o navegador) */
  submitIcon?: "seguir" | "buscar" | "confirmar";
  backLabel: string;
  backHref: string;
  /** Dentro do modal, o botão de voltar só fecha (a página de baixo é o `backHref`) */
  closesModal?: boolean;
}) {
  const modal = useOptionalRouteModal();
  const Icon =
    submitIcon === "seguir"
      ? ArrowRight
      : submitIcon === "buscar"
        ? RefreshCw
        : submitIcon === "confirmar"
          ? Check
          : null;
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] gap-2.5 md:flex md:justify-end">
      {modal && closesModal ? (
        <Button
          type="button"
          variant="outline"
          onClick={modal.close}
          className="h-11 rounded-xl px-4 text-sm font-semibold"
        >
          {backLabel}
        </Button>
      ) : (
        <Button asChild variant="outline" className="h-11 rounded-xl px-4 text-sm font-semibold">
          <Link href={backHref}>{backLabel}</Link>
        </Button>
      )}
      <Button
        type="submit"
        form={formId}
        className="h-11 gap-2 rounded-xl px-[1.125rem] text-sm font-bold"
      >
        {Icon ? <Icon aria-hidden /> : null}
        {submitLabel}
      </Button>
    </div>
  );
}
