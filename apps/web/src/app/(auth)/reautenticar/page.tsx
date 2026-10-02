import type { Metadata } from "next";
import Link from "next/link";
import { safeNextPath } from "@/lib/auth/routes";
import { requireUser } from "@/lib/auth/session";
import { AuthCard } from "@/features/auth/ui/auth-card";
import { ReauthForm } from "@/features/auth/ui/reauth-form";
import { TEXT_LINK } from "@/lib/styles";

export const metadata: Metadata = { title: "Confirme que é você" };

export default async function ReauthPage({ searchParams }: PageProps<"/reautenticar">) {
  const { session } = await requireUser();
  const params = await searchParams;
  const next = safeNextPath(typeof params.next === "string" ? params.next : null);

  return (
    <AuthCard
      title="Confirme que é você"
      description="Esta ação é sensível. Confirme sua identidade; a confirmação vale por 10 minutos."
      footer={
        <Link href={next} className={TEXT_LINK}>
          Cancelar e voltar
        </Link>
      }
    >
      <ReauthForm next={next} sessionId={session.id} />
    </AuthCard>
  );
}
