import { cookies } from "next/headers";
import { Brand } from "./brand";
import { BottomNav } from "./bottom-nav";
import { NewTransactionFab } from "./new-transaction-fab";
import { ShellBackdrop } from "./sidebar/shell-backdrop";
import { Sidebar } from "./sidebar/sidebar";
import { ShellGrid, SidebarProvider } from "./sidebar/sidebar-provider";
import { parseSidebarState, SIDEBAR_COOKIE } from "./sidebar/state";
import { ThemeToggle } from "./theme-toggle";

// A casca do app (M07.3). Computador: menu lateral marinho de vidro, com as luzes atrás dele
// (ShellBackdrop), recolhível pela alça na borda. Celular (abaixo de 768 px): cabeçalho e barra
// inferior de vidro e o botão flutuante de novo lançamento. O conteúdo é sempre sólido (ADR-008).
// O estado do menu vem do cookie, lido aqui no servidor, para a página já nascer do jeito certo.
export async function AppShell({
  children,
  modal,
}: {
  children: React.ReactNode;
  modal?: React.ReactNode;
}) {
  const sidebar = parseSidebarState((await cookies()).get(SIDEBAR_COOKIE)?.value);

  return (
    <SidebarProvider initial={sidebar}>
      <ShellGrid>
        {/* Primeiro item do Tab: permite pular o menu e ir direto ao conteúdo */}
        <a
          href="#conteudo"
          className="bg-primary text-primary-foreground focus-visible:ring-ring focus-visible:ring-offset-background sr-only z-50 rounded-lg px-4 py-2 outline-none focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus-visible:ring-3 focus-visible:ring-offset-2"
        >
          Pular para o conteúdo
        </a>
        <ShellBackdrop />
        <Sidebar />

        <div className="flex min-w-0 flex-col">
          <header className="glass sticky top-0 z-30 flex h-14 items-center justify-between border-b px-4 md:hidden">
            <Brand />
            <ThemeToggle />
          </header>
          <main
            id="conteudo"
            tabIndex={-1}
            className="mx-auto w-full max-w-[65rem] flex-1 px-4 pt-5 pb-36 outline-none md:px-11 md:pt-9 md:pb-12"
          >
            {children}
          </main>
        </div>

        <NewTransactionFab />
        {/* Modal aberto por rota interceptada (o novo lançamento na web e no celular) */}
        {modal}
        <BottomNav />
      </ShellGrid>
    </SidebarProvider>
  );
}
