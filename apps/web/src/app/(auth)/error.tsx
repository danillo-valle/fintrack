"use client";

import { ErrorState } from "@/components/feedback/error-state";

// Erro numa tela de entrada (M12.1, OWASP A10, linha I do canvas). Antes, ele caía na página
// genérica do Next.js, fora do layout. A caixa é o título da página (h1): o erro pode acontecer em
// qualquer uma das telas de entrada, e nenhum título delas valeria para todas.
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="w-full max-w-md">
      <ErrorState
        headingLevel={1}
        title="Não foi possível abrir esta tela"
        description="Pode ser uma falha passageira. Tente de novo; se continuar, volte para a tela de entrar."
        onRetry={reset}
        code={error.digest}
        home={{ href: "/entrar", label: "Ir para Entrar" }}
      />
    </div>
  );
}
