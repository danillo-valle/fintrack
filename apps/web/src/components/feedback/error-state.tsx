"use client";

import { RefreshCw, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";

type Props = {
  title?: string;
  /** Diga o que aconteceu e o que a pessoa pode fazer. Nada de "Erro desconhecido". */
  description?: string;
  onRetry?: () => void;
};

export function ErrorState({
  title = "Não foi possível carregar esta página",
  description = "Pode ser uma falha passageira de conexão. Tente de novo; se continuar, recarregue o navegador.",
  onRetry,
}: Props) {
  return (
    <div
      role="alert"
      className="border-destructive/30 bg-destructive/5 flex flex-col items-start gap-3 rounded-xl border p-6"
    >
      <TriangleAlert aria-hidden className="text-destructive size-6" />
      <div>
        <h2 className="font-semibold">{title}</h2>
        <p className="text-muted-foreground mt-1 text-sm">{description}</p>
      </div>
      {onRetry ? (
        <Button type="button" variant="outline" onClick={onRetry}>
          <RefreshCw aria-hidden />
          Tentar de novo
        </Button>
      ) : null}
    </div>
  );
}
