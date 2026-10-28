import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { helpArticle } from "@/features/help/content";
import { ArticleBody } from "@/features/help/ui/article-body";
import { requireUser } from "@/lib/auth/session";
import { TEXT_LINK } from "@/lib/styles";

export async function generateMetadata({ params }: PageProps<"/ajuda/[slug]">): Promise<Metadata> {
  const article = helpArticle((await params).slug);
  return { title: article ? `Ajuda: ${article.title}` : "Ajuda" };
}

// Um artigo da Ajuda na página inteira (prancha J-CelAjuda; no computador, pelo "?" de uma tela
// ele abre em modal). Endereço que não é de um artigo: 404.
export default async function HelpArticlePage({ params }: PageProps<"/ajuda/[slug]">) {
  await requireUser();
  const article = helpArticle((await params).slug);
  if (!article) notFound();
  return (
    <>
      <PageHeader
        help={null}
        crumb={{ href: "/ajuda", label: "Ajuda" }}
        title={article.title}
        description={article.summary}
        actions={
          article.screen ? (
            <Link
              href={article.screen}
              className={`${TEXT_LINK} inline-flex min-h-10 items-center gap-1.5 font-bold`}
            >
              Ir para a tela
              <ArrowRight aria-hidden className="size-4" />
            </Link>
          ) : null
        }
      />
      <article className="bg-card max-w-3xl rounded-[1.25rem] border p-4 md:p-6">
        <ArticleBody article={article} />
      </article>
    </>
  );
}
