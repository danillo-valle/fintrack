import Link from "next/link";
import { ChevronRight } from "lucide-react";
import type { HelpSlug } from "@/features/help/content";
import { HelpButton } from "@/features/help/ui/help-button";
import { TEXT_LINK } from "@/lib/styles";
import { ContentReady } from "./content-ready";

type Props = {
  title: string;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  /**
   * A página de cima, em cima do título ("Lançamentos ›"): canvas E.2 (M09.2). `trail`: as
   * páginas acima dela, só no computador ("Lançamentos · Recebidos do banco ›", canvas E.3)
   */
  crumb?: { href: string; label: string; trail?: string };
  /**
   * A parte da Ajuda que explica esta tela (M12.3a): o "?" ao lado do título. Obrigatório: toda
   * tela decide; `null` só nas que não têm uma (a própria Ajuda, o catálogo de desenvolvimento).
   */
  help: HelpSlug | null;
};

// Toda página começa com um único <h1>: é por ele que o leitor de tela se orienta.
// Visual Elétrico (M07.2; medidas do M07.3): título grande e firme, sem rótulo em caixa alta em
// cima, e a ação principal da página (Novo lançamento, por exemplo) alinhada embaixo, à direita.
export function PageHeader({ title, description, actions, crumb, help }: Props) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-4 md:mb-6">
      {/* Marca "pronto" quando o conteúdo desta página hidratou (testes E2E; content-ready.tsx) */}
      <ContentReady />
      <div className="min-w-0">
        {crumb ? (
          <nav aria-label="Caminho" className="mb-1 text-sm">
            <Link
              href={crumb.href}
              className={`${TEXT_LINK} text-muted-foreground inline-flex min-h-8 items-center gap-1.5`}
            >
              {crumb.trail ? <span className="hidden md:inline">{crumb.trail} · </span> : null}
              {crumb.label}
              <ChevronRight aria-hidden className="size-3.5" />
            </Link>
          </nav>
        ) : null}
        <div className="flex items-center gap-3">
          <h1 className="text-[1.875rem] font-extrabold tracking-[-0.03em] text-balance md:text-[2.5rem]">
            {title}
          </h1>
          {help ? <HelpButton slug={help} /> : null}
        </div>
        {description ? (
          <p className="text-muted-foreground mt-1 text-sm md:text-[0.9375rem]">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}
