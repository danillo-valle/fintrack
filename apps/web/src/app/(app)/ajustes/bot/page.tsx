import type { Metadata } from "next";
import { connection } from "next/server";
import { MessageCircle } from "lucide-react";
import { EmptyState } from "@/components/feedback/empty-state";
import { PageHeader } from "@/components/layout/page-header";
import { getBotSettings } from "@/features/bot/server/queries";
import {
  BotStatusCard,
  ChannelsCard,
  PreferenceCard,
  RecentCard,
  UsageCard,
} from "@/features/bot/ui/settings";
import { requireUser } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Bot de lançamento" };

// Ajustes › Bot de lançamento (M11, pranchas G-Ajustes e G-CelAjustes; M12.0b, H-Ajustes e
// H-CelAjustes): o interruptor do lar, os canais da pessoa (WhatsApp e Telegram: vincular e
// desvincular), os padrões, a conta das respostas grátis do WhatsApp e as últimas mensagens, sem o
// texto.
export default async function BotSettingsPage() {
  const session = await requireUser();
  await connection(); // "hoje", o mês da conta: a hora do pedido, nunca a do build
  const now = new Date();
  const page = await getBotSettings(session, now);
  const header = (
    <PageHeader
      crumb={{ href: "/ajustes", label: "Ajustes" }}
      title="Bot de lançamento"
      description="Lance um gasto mandando uma mensagem pelo WhatsApp ou pelo Telegram. Ele chega como provisório e só vale depois do seu Confirmar."
    />
  );
  if (!page) {
    return (
      <>
        {header}
        <EmptyState
          icon={MessageCircle}
          title="Você ainda não tem um lar"
          description="Crie o seu lar em Carteiras primeiro."
        />
      </>
    );
  }
  return (
    <>
      {header}
      {/* No celular, as duas colunas viram uma (contents) e a ordem vem de cada cartão */}
      <div className="flex max-w-5xl flex-col gap-4 md:grid md:grid-cols-2 md:items-start md:gap-4">
        <div className="contents md:flex md:min-w-0 md:flex-col md:gap-4">
          <BotStatusCard page={page} />
          <ChannelsCard page={page} />
          <PreferenceCard page={page} />
        </div>
        <div className="contents md:flex md:min-w-0 md:flex-col md:gap-4">
          <UsageCard page={page} now={now} />
          <RecentCard page={page} now={now} />
        </div>
      </div>
    </>
  );
}
