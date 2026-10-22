import { connection } from "next/server";
import { RouteModal } from "@/components/ui/route-modal";
import { getLinkCode } from "@/features/bot/server/queries";
import { LinkCodeBody, linkCodeTitle } from "@/features/bot/ui/link-code";
import { LinkCodeFooter } from "@/features/bot/ui/link-code-footer";
import { requireRecentAuth } from "@/lib/auth/session";

// O código de vínculo em modal, por cima de Ajustes › Bot (prancha G-Vincular). A mesma prova de
// identidade da página: sem ela, vai para /reautenticar e volta.
export default async function LinkCodeModal({
  searchParams,
}: {
  searchParams: Promise<{ codigo?: string }>;
}) {
  const session = await requireRecentAuth("/ajustes/bot");
  await connection();
  const { codigo } = await searchParams;
  const page = await getLinkCode(session, codigo ?? "");
  if (!page) {
    return (
      <RouteModal title="Vincular número">
        <p className="text-sm">O bot ainda não está configurado neste servidor.</p>
      </RouteModal>
    );
  }
  return (
    <RouteModal
      title={linkCodeTitle(page)}
      eyebrow="Vincular número"
      footer={<LinkCodeFooter state={page.status.state} />}
    >
      <LinkCodeBody page={page} idPrefix="modal-" />
    </RouteModal>
  );
}
