import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Button } from "@/components/ui/button";
import { AuthCard } from "@/features/auth/ui/auth-card";
import { helpArticle } from "@/features/help/content";
import { ArticleBody } from "@/features/help/ui/article-body";
import { TEXT_LINK } from "@/lib/styles";

export const metadata: Metadata = { title: "Primeiro acesso" };

// A única parte PÚBLICA da Ajuda (M12.3a, decisão de 27/10, prancha J-PrimeiroAcesso): o passo a
// passo para criar a conta e ligar o 2FA, ligado de Entrar e de Criar conta. O resto da Ajuda é só
// para quem entrou. O texto é o mesmo artigo da Ajuda (content.ts).
export default function FirstAccessPage() {
  const article = helpArticle("primeiro-acesso");
  if (!article) notFound();
  return (
    <AuthCard
      title="Primeiro acesso"
      description={article.summary}
      footer={
        <>
          Já tem conta?{" "}
          <Link href="/entrar" className={TEXT_LINK}>
            Entrar
          </Link>
        </>
      }
    >
      <div className="flex flex-col gap-6">
        <ArticleBody article={article} />
        <Button asChild className="h-11 rounded-xl font-bold">
          <Link href="/cadastro">Criar conta</Link>
        </Button>
      </div>
    </AuthCard>
  );
}
