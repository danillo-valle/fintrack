import { connection } from "next/server";
import { RouteModal } from "@/components/ui/route-modal";
import { channelFromParam } from "@/features/bot/schemas";
import { getLinkCode } from "@/features/bot/server/queries";
import { LinkCodeBody, linkCodeEyebrow, linkCodeTitle } from "@/features/bot/ui/link-code";
import { LinkCodeFooter } from "@/features/bot/ui/link-code-footer";
import { requireRecentAuth } from "@/lib/auth/session";

// O código de vínculo em modal, por cima de Ajustes › Bot (pranchas G-Vincular e H-Vincular). A mesma prova de
// identidade da página: sem ela, vai para /reautenticar e volta.
export default async function LinkCodeModal({
  searchParams,
}: {
  searchParams: Promise<{ codigo?: string; canal?: string }>;
}) {
  const session = await requireRecentAuth("/ajustes/bot");
  await connection();
  const { codigo, canal } = await searchParams;
  const page = await getLinkCode(session, codigo ?? "", channelFromParam(canal));
  if (!page) {
    return (
      <RouteModal title="Vincular">
        <p className="text-sm">O bot ainda não está configurado neste servidor.</p>
      </RouteModal>
    );
  }
  return (
    <RouteModal
      title={linkCodeTitle(page)}
      eyebrow={linkCodeEyebrow(page)}
      footer={
        <LinkCodeFooter
          state={page.status.state}
          channel={page.channel === "TELEGRAM" ? "telegram" : "whatsapp"}
        />
      }
    >
      <LinkCodeBody page={page} idPrefix="modal-" />
    </RouteModal>
  );
}
