"use client";

import { createContext, useCallback, useContext, useState } from "react";
import { SIDEBAR_COOKIE, type SidebarState } from "./sidebar-state";

type SidebarContextValue = { state: SidebarState; toggle: () => void };

const SidebarContext = createContext<SidebarContextValue | null>(null);

export function useSidebar(): SidebarContextValue {
  const value = useContext(SidebarContext);
  if (!value) throw new Error("useSidebar fora do ShellFrame");
  return value;
}

// A grade da casca: menu lateral + conteúdo. É de cliente só para guardar se o menu está
// recolhido; todo o resto (menu, páginas) continua vindo do servidor como children.
// data-sidebar alimenta a variante "collapsed:" do globals.css.
export function ShellFrame({
  initial,
  children,
}: {
  initial: SidebarState;
  children: React.ReactNode;
}) {
  const [state, setState] = useState<SidebarState>(initial);

  const toggle = useCallback(() => {
    setState((current) => {
      const next = current === "collapsed" ? "expanded" : "collapsed";
      // um ano; só a preferência de tela, nenhum dado pessoal
      document.cookie = `${SIDEBAR_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
      return next;
    });
  }, []);

  return (
    <SidebarContext value={{ state, toggle }}>
      <div
        data-sidebar={state}
        className="app-glow min-h-dvh motion-reduce:transition-none md:grid md:grid-cols-[15rem_minmax(0,1fr)] md:transition-[grid-template-columns] md:duration-200 md:ease-out md:data-[sidebar=collapsed]:grid-cols-[4.5rem_minmax(0,1fr)]"
      >
        {children}
      </div>
    </SidebarContext>
  );
}
