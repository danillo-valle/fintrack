// O "?" ao lado do título de cada tela (M12.3a, prancha J-AjudaDaTela): leva à parte da Ajuda
// que explica a tela. No app, abre em modal por cima dela (@modal/(.)ajuda/[slug]); aberto
// direto (ou sem JavaScript), é a página inteira.
import Link from "next/link";
import { CircleHelp } from "lucide-react";
import { helpArticle, type HelpSlug } from "../content";

export function HelpButton({ slug }: { slug: HelpSlug }) {
  const article = helpArticle(slug);
  if (!article) return null;
  return (
    <Link
      href={`/ajuda/${slug}`}
      // O nome é sempre o mesmo: o título do artigo às vezes é igual ao de um botão da tela
      // ("Conectar o Meu Pluggy"), e o leitor de tela já sabe a tela pelo <h1>
      aria-label="Ajuda desta tela"
      title={`Ajuda: ${article.title}`}
      data-testid="ajuda-da-tela"
      className="border-border bg-card text-foreground hover:bg-muted focus-visible:ring-ring inline-flex size-10 shrink-0 items-center justify-center rounded-full border outline-none focus-visible:ring-3"
    >
      <CircleHelp aria-hidden className="size-5" />
    </Link>
  );
}
