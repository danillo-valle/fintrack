import type { Metadata } from "next";
import { PageHeader } from "@/components/layout/page-header";
import { searchHelp } from "@/features/help/search";
import { HelpResults, HelpSearch, HelpTopics } from "@/features/help/ui/help-index";
import { requireUser } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Ajuda" };

// A Ajuda (M12.3a, ADR-022, prancha J-Ajuda): o manual do usuário, por tópicos, com a busca. Em
// cada tela, o "?" ao lado do título abre a parte dela (@modal/(.)ajuda/[slug]).
export default async function HelpPage({ searchParams }: PageProps<"/ajuda">) {
  await requireUser();
  const raw = (await searchParams).q;
  const query = (typeof raw === "string" ? raw : "").trim();
  return (
    <>
      <PageHeader
        help={null}
        title="Ajuda"
        description="Como usar o FinTrack, tela por tela. Em cada tela, o botão com o ponto de interrogação abre a parte dela."
      />
      <div className="flex max-w-5xl flex-col gap-5">
        <HelpSearch query={query} />
        {query ? <HelpResults query={query} results={searchHelp(query)} /> : <HelpTopics />}
      </div>
    </>
  );
}
