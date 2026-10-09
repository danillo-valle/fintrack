import Link from "next/link";
import { cookies } from "next/headers";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Brand } from "./brand";
import { NavLink } from "./nav-link";
import { NewTransactionFab } from "./new-transaction-fab";
import { NAV_ITEMS } from "./nav-items";
import { ShellFrame } from "./shell-frame";
import { SidebarLabel } from "./sidebar-label";
import { parseSidebarState, SIDEBAR_COOKIE } from "./sidebar-state";
import { SidebarToggle } from "./sidebar-toggle";
import { ThemeToggle } from "./theme-toggle";

// A casca do app: menu lateral no desktop, barra inferior e botão flutuante no celular.
// Visual C (ADR-008): o vidro fica só na moldura (cabeçalho e barra inferior do celular e, desde o
// M07.2, o menu lateral); o conteúdo fica sólido. O brilho suave (app-glow) é o que aparece através
// do vidro. O menu lateral recolhe até ficarem só os ícones; a escolha fica num cookie.
// "md:" = telas a partir de 768px. Abaixo disso, vale o layout de celular.
export async function AppShell({
  children,
  modal,
}: {
  children: React.ReactNode;
  modal?: React.ReactNode;
}) {
  const sidebar = parseSidebarState((await cookies()).get(SIDEBAR_COOKIE)?.value);

  return (
    <ShellFrame initial={sidebar}>
      {/* Primeiro item do Tab: permite pular o menu e ir direto ao conteúdo */}
      <a
        href="#conteudo"
        className="bg-primary text-primary-foreground focus-visible:ring-ring focus-visible:ring-offset-background sr-only z-50 rounded-lg px-4 py-2 outline-none focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus-visible:ring-3 focus-visible:ring-offset-2"
      >
        Pular para o conteúdo
      </a>

      <aside
        id="menu-lateral"
        aria-label="Menu lateral"
        className="glass-sidebar sticky top-0 z-40 hidden h-dvh flex-col gap-6 border-r px-3 py-5 md:flex"
      >
        <div className="collapsed:px-1.5 px-2">
          <Brand collapsible />
        </div>
        <Button
          asChild
          size="lg"
          className="group/item collapsed:justify-center collapsed:px-0 relative h-10 justify-start px-3"
        >
          <Link href="/lancamentos/novo">
            <Plus aria-hidden />
            <SidebarLabel>Novo lançamento</SidebarLabel>
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
        <div className="mt-auto flex flex-col gap-1">
          <ThemeToggle placement="sidebar" />
          <SidebarToggle />
        </div>
      </aside>

      <div className="flex min-w-0 flex-col">
        <header className="glass sticky top-0 z-30 flex h-14 items-center justify-between border-b px-4 md:hidden">
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

      {/* Modal aberto por rota interceptada (o novo lançamento na web e no celular) */}
      {modal}

      <nav
        aria-label="Principal"
        className="glass fixed inset-x-0 bottom-0 z-30 border-t pb-[env(safe-area-inset-bottom)] md:hidden"
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
    </ShellFrame>
  );
}
