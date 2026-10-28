import type { Metadata } from "next";
import { connection } from "next/server";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { channelFromParam } from "@/features/bot/schemas";
import { getLinkCode } from "@/features/bot/server/queries";
import { LinkCodeBody, linkCodeEyebrow, linkCodeTitle } from "@/features/bot/ui/link-code";
import { requireRecentAuth } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Vincular um canal do bot" };

// O código de vínculo na página inteira (recarregar ou abrir o link direto). Pelo app, abre em
// modal por cima de Ajustes › Bot (@modal/(.)ajustes/bot/vincular). O código só aparece para quem
// o gerou, com prova de identidade recente (M03).
export default async function LinkCodePage({
  searchParams,
}: {
  searchParams: Promise<{ codigo?: string; canal?: string }>;
}) {
  const session = await requireRecentAuth("/ajustes/bot");
  await connection();
  const { codigo, canal } = await searchParams;
  const page = await getLinkCode(session, codigo ?? "", channelFromParam(canal));
  if (!page) notFound();
  return (
    <>
      <PageHeader
        help="bot-vincular"
        crumb={{ href: "/ajustes/bot", label: "Bot de lançamento" }}
        title={linkCodeTitle(page)}
        description={linkCodeEyebrow(page)}
      />
      <div className="bg-card flex max-w-xl flex-col gap-5 rounded-[1.25rem] border p-4 md:p-6">
        <LinkCodeBody page={page} />
      </div>
    </>
  );
}
