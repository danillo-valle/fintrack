"use client";

// A caixa de erro de uma tela (o error.tsx de cada grupo de rotas). M12.1 (OWASP A10, linha I do
// canvas): mostra o código do erro, o mesmo "digest" que o instrumentation.ts grava no log com o
// caminho. Com ele, quem pede ajuda leva direto ao registro do erro, e a tela nunca mostra a
// mensagem nem a pilha do erro.
import Link from "next/link";
import { House, RefreshCw, TriangleAlert } from "lucide-react";
import { CopyButton } from "@/components/feedback/copy-button";
import { Button } from "@/components/ui/button";

type Props = {
  title?: string;
  /** Diga o que aconteceu e o que a pessoa pode fazer. Nada de "Erro desconhecido". */
  description?: string;
  onRetry?: () => void;
  /** O digest do erro (só os erros do servidor têm): aparece com o botão Copiar */
  code?: string;
  /** Para onde ir se tentar de novo não resolver */
  home?: { href: string; label: string };
  /** 1 quando a caixa é o título da página (as telas de entrada); 2 dentro de uma página */
  headingLevel?: 1 | 2;
};

export function ErrorState({
  title = "Não foi possível carregar esta página",
  description = "Pode ser uma falha passageira de conexão. Tente de novo; se continuar, recarregue o navegador.",
  onRetry,
  code,
  home,
  headingLevel = 2,
}: Props) {
  const Heading = headingLevel === 1 ? "h1" : "h2";
  return (
    <div
      role="alert"
      className="border-destructive/30 bg-destructive/5 flex flex-col items-start gap-3.5 rounded-xl border p-6"
    >
      <TriangleAlert aria-hidden className="text-destructive size-6" />
      <div>
        <Heading className="font-semibold">{title}</Heading>
        <p className="text-muted-foreground mt-1 text-sm">{description}</p>
      </div>
      {code ? (
        <>
          <div className="bg-card flex flex-wrap items-center gap-x-2.5 gap-y-2 rounded-lg border px-3 py-2 text-sm">
            <span>Código do erro</span>
            <span id="codigo-do-erro" className="font-mono font-bold" data-testid="codigo-do-erro">
              {code}
            </span>
            <CopyButton
              text={code}
              targetId="codigo-do-erro"
              label="Copiar o código do erro"
              size="compact"
            />
          </div>
          <p className="text-muted-foreground text-[0.8125rem]">
            Se pedir ajuda, mande este código: ele leva direto ao registro do erro, sem expor nada
            seu.
          </p>
        </>
      ) : null}
      {onRetry || home ? (
        <div className="flex flex-wrap gap-2.5">
          {onRetry ? (
            <Button type="button" variant="outline" onClick={onRetry}>
              <RefreshCw aria-hidden />
              Tentar de novo
            </Button>
          ) : null}
          {home ? (
            <Button asChild variant="ghost">
              <Link href={home.href}>
                <House aria-hidden />
                {home.label}
              </Link>
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
