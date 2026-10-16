import type { Metadata } from "next";
import { connection } from "next/server";
import { Sparkles } from "lucide-react";
import { EmptyState } from "@/components/feedback/empty-state";
import { PageHeader } from "@/components/layout/page-header";
import { getCategorizationPage } from "@/features/categories/server/categorization";
import {
  AutomaticShare,
  ClassifierCard,
  LayerBreakdown,
  LocalAiCard,
} from "@/features/categories/ui/categorization";
import { requireUser } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Categorização" };

// Ajustes › Categorização (M10.1, pranchas F-Inteligencia e F-CelInteligencia): o quanto a
// cascata resolveu sozinha, sem IA, camada por camada, e o classificador. Os números são das
// carteiras que a pessoa vê, nos últimos 30 dias.
export default async function CategorizationSettingsPage() {
  const session = await requireUser();
  await connection(); // "hoje", "treinado às": a hora do pedido, nunca a do build
  const page = await getCategorizationPage(session);
  if (!page) {
    return (
      <>
        <PageHeader crumb={{ href: "/ajustes", label: "Ajustes" }} title="Categorização" />
        <EmptyState
          icon={Sparkles}
          title="Você ainda não tem um lar"
          description="Crie o seu lar em Carteiras primeiro."
        />
      </>
    );
  }
  return (
    <>
      <PageHeader
        crumb={{ href: "/ajustes", label: "Ajustes" }}
        title="Categorização"
        description="Quem sugere a categoria de cada lançamento, na ordem em que tenta"
      />
      <div className="flex max-w-5xl flex-col gap-4 md:gap-5">
        <section
          aria-label="Quem categorizou"
          className="bg-card grid gap-4 rounded-[1.25rem] border p-4 md:grid-cols-[17.5rem_minmax(0,1fr)] md:gap-7 md:p-6"
        >
          <AutomaticShare page={page} />
          <div className="flex min-w-0 flex-col gap-3">
            <LayerBreakdown page={page} />
            <p className="text-muted-foreground text-[0.8125rem]">
              Cada número leva aos lançamentos que aquela camada categorizou. Os que ainda esperam
              revisão em Recebidos entram aqui quando você confirma.
            </p>
          </div>
        </section>
        <div className="grid items-start gap-4 md:grid-cols-2">
          <ClassifierCard page={page} now={new Date()} />
          <LocalAiCard />
        </div>
      </div>
    </>
  );
}
