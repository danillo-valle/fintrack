"use client";

// O rodapé do modal do código (prancha G-Vincular): "Cancelar" enquanto espera, "Fechar" depois.
// Os dois só fecham o modal (o código esperando continua valendo os 10 minutos).
import { Button } from "@/components/ui/button";
import { useRouteModal } from "@/components/ui/route-modal";
import { StartLinkButton } from "./forms";

export function LinkCodeFooter({ state }: { state: "WAITING" | "LINKED" | "EXPIRED" }) {
  const { close } = useRouteModal();
  return (
    <div className="flex flex-wrap justify-end gap-2.5">
      {state === "WAITING" ? (
        <StartLinkButton label="Gerar outro código" variant="outline" />
      ) : null}
      {state === "LINKED" ? (
        <Button type="button" onClick={close} className="h-11 px-4">
          Fechar
        </Button>
      ) : (
        <Button type="button" variant="outline" onClick={close} className="h-11 px-4">
          {state === "WAITING" ? "Cancelar" : "Fechar"}
        </Button>
      )}
    </div>
  );
}
