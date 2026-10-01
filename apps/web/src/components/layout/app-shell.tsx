import Link from "next/link";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Brand } from "./brand";
import { NavLink } from "./nav-link";
import { NewTransactionFab } from "./new-transaction-fab";
import { NAV_ITEMS } from "./nav-items";
import { ThemeToggle } from "./theme-toggle";

// A casca do app: menu lateral no desktop, barra inferior e botão flutuante no celular.
// "md:" = telas a partir de 768px. Abaixo disso, vale o layout de celular.
export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh md:grid md:grid-cols-[15rem_minmax(0,1fr)]">
      {/* Primeiro item do Tab: permite pular o menu e ir direto ao conteúdo */}
      <a
        href="#conteudo"
        className="bg-primary text-primary-foreground sr-only z-50 rounded-lg px-4 py-2 focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
      >
        Pular para o conteúdo
      </a>

      <aside className="bg-sidebar border-sidebar-border sticky top-0 hidden h-dvh flex-col gap-6 border-r px-3 py-5 md:flex">
        <div className="px-2">
          <Brand />
        </div>
        <Button asChild size="lg" className="h-10 justify-start px-3">
          <Link href="/lancamentos/novo">
            <Plus aria-hidden />
            Novo lançamento
          </Link>
        </Button>
        <nav aria-label="Principal">
          <ul className="flex flex-col gap-1">
            {NAV_ITEMS.map((item) => (
              <li key={item.href}>
                <NavLink
                  href={item.href}
                  label={item.label}
                  variant="sidebar"
                  icon={<item.icon aria-hidden className="size-5 shrink-0" />}
                />
              </li>
            ))}
          </ul>
        </nav>
        <div className="mt-auto">
          <ThemeToggle />
        </div>
      </aside>

      <div className="flex min-w-0 flex-col">
        <header className="bg-background/95 sticky top-0 z-30 flex h-14 items-center justify-between border-b px-4 backdrop-blur md:hidden">
          <Brand />
          <ThemeToggle />
        </header>
        <main
          id="conteudo"
          tabIndex={-1}
          className="mx-auto w-full max-w-5xl flex-1 px-4 pt-6 pb-36 outline-none md:px-8 md:pt-10 md:pb-12"
        >
          {children}
        </main>
      </div>

      <NewTransactionFab />

      <nav
        aria-label="Principal"
        className="bg-background fixed inset-x-0 bottom-0 z-30 border-t pb-[env(safe-area-inset-bottom)] md:hidden"
      >
        <ul className="grid grid-cols-5">
          {NAV_ITEMS.map((item) => (
            <li key={item.href}>
              <NavLink
                href={item.href}
                label={item.label}
                variant="bottom"
                icon={<item.icon aria-hidden className="size-5 shrink-0" />}
              />
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}
