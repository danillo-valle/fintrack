import { RouteModal } from "@/components/ui/route-modal";
import { helpArticle } from "@/features/help/content";
import { ArticleBody } from "@/features/help/ui/article-body";
import { HelpModalFooter } from "@/features/help/ui/help-modal-footer";
import { requireUser } from "@/lib/auth/session";

// O "?" de uma tela abre a ajuda dela em modal, por cima da tela (prancha J-AjudaDaTela; no
// celular, o painel que sobe da base). "Abrir na Ajuda" leva à página inteira.
export default async function HelpArticleModal({ params }: PageProps<"/ajuda/[slug]">) {
  await requireUser();
  const article = helpArticle((await params).slug);
  if (!article) {
    return (
      <RouteModal title="Ajuda">
        <p className="text-sm">Esta parte da Ajuda não existe. Veja todos os tópicos em Ajuda.</p>
      </RouteModal>
    );
  }
  return (
    <RouteModal
      title={article.title}
      eyebrow="Ajuda"
      description={article.summary}
      footer={<HelpModalFooter slug={article.slug} />}
    >
      <ArticleBody article={article} idPrefix="modal-" />
    </RouteModal>
  );
}
