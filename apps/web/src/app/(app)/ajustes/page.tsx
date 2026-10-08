import type { Metadata } from "next";
import Link from "next/link";
import { ChevronRight, House, Landmark, ShieldCheck, Tags } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { requireUser } from "@/lib/auth/session";
import { SignOutButton } from "@/features/auth/ui/sign-out-button";

export const metadata: Metadata = { title: "Ajustes" };

export default async function SettingsPage() {
  const { user } = await requireUser();

  return (
    <>
      <PageHeader title="Ajustes" />
      <div className="flex max-w-md flex-col gap-6">
        <section aria-labelledby="conta" className="rounded-xl border p-5">
          <h2 id="conta" className="font-semibold">
            Conta
          </h2>
          <p className="text-muted-foreground mt-1 mb-4 text-sm break-all">
            {user.name} · {user.email}
          </p>
          <div className="flex flex-col gap-3">
            <Link
              href="/ajustes/contas"
              className="hover:bg-muted focus-visible:ring-ring flex items-center justify-between gap-2 rounded-lg border px-4 py-3 text-sm font-medium outline-none focus-visible:ring-3"
            >
              <span className="flex items-center gap-2">
                <Landmark aria-hidden className="size-4" />
                Contas e cartões
              </span>
              <ChevronRight aria-hidden className="size-4" />
            </Link>
            <Link
              href="/ajustes/categorias"
              className="hover:bg-muted focus-visible:ring-ring flex items-center justify-between gap-2 rounded-lg border px-4 py-3 text-sm font-medium outline-none focus-visible:ring-3"
            >
              <span className="flex items-center gap-2">
                <Tags aria-hidden className="size-4" />
                Categorias e regras
              </span>
              <ChevronRight aria-hidden className="size-4" />
            </Link>
            <Link
              href="/ajustes/lar"
              className="hover:bg-muted focus-visible:ring-ring flex items-center justify-between gap-2 rounded-lg border px-4 py-3 text-sm font-medium outline-none focus-visible:ring-3"
            >
              <span className="flex items-center gap-2">
                <House aria-hidden className="size-4" />
                Lar: pessoas, convites e atividade
              </span>
              <ChevronRight aria-hidden className="size-4" />
            </Link>
            <Link
              href="/ajustes/seguranca"
              className="hover:bg-muted focus-visible:ring-ring flex items-center justify-between gap-2 rounded-lg border px-4 py-3 text-sm font-medium outline-none focus-visible:ring-3"
            >
              <span className="flex items-center gap-2">
                <ShieldCheck aria-hidden className="size-4" />
                Segurança: 2FA, passkeys e sessões
              </span>
              <ChevronRight aria-hidden className="size-4" />
            </Link>
            <div>
              <SignOutButton />
            </div>
          </div>
        </section>

        <section aria-labelledby="aparencia" className="rounded-xl border p-5">
          <h2 id="aparencia" className="font-semibold">
            Aparência
          </h2>
          <p className="text-muted-foreground mt-1 mb-4 text-sm">
            &quot;Sistema&quot; segue o modo claro ou escuro do seu aparelho.
          </p>
          <ThemeToggle />
        </section>
      </div>
    </>
  );
}
