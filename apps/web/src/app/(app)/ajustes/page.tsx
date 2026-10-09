import type { Metadata } from "next";
import Link from "next/link";
import { ChevronRight, House, Landmark, ShieldCheck, Tags, type LucideIcon } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { HeroPanel } from "@/components/visual/hero-panel";
import { IconTile, type Tone } from "@/components/visual/icon-tile";
import { Section } from "@/components/visual/section";
import { SurfaceList } from "@/components/visual/surface-list";
import { requireUser } from "@/lib/auth/session";
import { SignOutButton } from "@/features/auth/ui/sign-out-button";

export const metadata: Metadata = { title: "Ajustes" };

const LINKS: { href: string; title: string; detail: string; icon: LucideIcon; tone: Tone }[] = [
  {
    href: "/ajustes/contas",
    title: "Contas e cartões",
    detail: "De onde sai e para onde vai o dinheiro",
    icon: Landmark,
    tone: 1,
  },
  {
    href: "/ajustes/categorias",
    title: "Categorias e regras",
    detail: "O que é cada gasto e as sugestões automáticas",
    icon: Tags,
    tone: 3,
  },
  {
    href: "/ajustes/lar",
    title: "Lar",
    detail: "Pessoas, convites e atividade",
    icon: House,
    tone: 2,
  },
  {
    href: "/ajustes/seguranca",
    title: "Segurança",
    detail: "2FA, passkeys e sessões",
    icon: ShieldCheck,
    tone: 5,
  },
];

// Ajustes (M07.2): o perfil no painel elétrico e os caminhos numa lista agrupada.
export default async function SettingsPage() {
  const { user } = await requireUser();
  const initials = user.name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join("");

  return (
    <>
      <PageHeader title="Ajustes" />
      <div className="flex max-w-2xl flex-col gap-6">
        <HeroPanel labelledBy="conta">
          <div className="flex items-center gap-4">
            <span
              aria-hidden
              className="bg-highlight text-highlight-foreground flex size-14 shrink-0 items-center justify-center rounded-2xl text-xl font-bold"
            >
              {initials}
            </span>
            <div className="min-w-0">
              <h2 id="conta" className="text-xl font-semibold tracking-tight break-words">
                {user.name}
              </h2>
              <p className="text-sm break-all opacity-90">{user.email}</p>
            </div>
          </div>
        </HeroPanel>

        <nav aria-label="Ajustes">
          <SurfaceList>
            {LINKS.map((l) => (
              <li key={l.href}>
                <Link
                  href={l.href}
                  className="hover:bg-muted focus-visible:ring-ring flex min-h-16 items-center gap-3 px-4 py-3 outline-none focus-visible:ring-3 focus-visible:ring-inset"
                >
                  <IconTile tone={l.tone} icon={l.icon} size="sm" />
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium">{l.title}</span>
                    <span className="text-muted-foreground block text-sm">{l.detail}</span>
                  </span>
                  <ChevronRight aria-hidden className="text-muted-foreground size-4 shrink-0" />
                </Link>
              </li>
            ))}
          </SurfaceList>
        </nav>

        <Section
          id="aparencia"
          title="Aparência"
          description={<>&quot;Sistema&quot; segue o modo claro ou escuro do seu aparelho.</>}
        >
          <ThemeToggle />
        </Section>

        <div>
          <SignOutButton />
        </div>
      </div>
    </>
  );
}
