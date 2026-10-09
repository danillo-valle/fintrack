"use client";

import { createContext, useCallback, useContext, useState } from "react";
import { sidebarCookie, type SidebarState } from "./state";

type SidebarContextValue = { state: SidebarState; toggle: () => void };

const SidebarContext = createContext<SidebarContextValue | null>(null);

export function useSidebar(): SidebarContextValue {
  const value = useContext(SidebarContext);
  if (!value) throw new Error("useSidebar fora do SidebarProvider");
  return value;
}

// Guarda se o menu lateral está recolhido. O estado inicial vem do cookie, lido no servidor.
export function SidebarProvider({
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
      document.cookie = sidebarCookie(next);
      return next;
    });
  }, []);
  return <SidebarContext value={{ state, toggle }}>{children}</SidebarContext>;
}

// A grade da casca: menu lateral + conteúdo. data-sidebar alimenta a variante "collapsed:" do
// globals.css; a largura da coluna anima, menos para quem pediu menos movimento.
export function ShellGrid({ children }: { children: React.ReactNode }) {
  const { state } = useSidebar();
  return (
    <div
      data-sidebar={state}
      className="app-glow relative isolate min-h-dvh motion-reduce:transition-none md:grid md:grid-cols-[14.5rem_minmax(0,1fr)] md:transition-[grid-template-columns] md:duration-200 md:ease-out md:data-[sidebar=collapsed]:grid-cols-[4.75rem_minmax(0,1fr)]"
    >
      {children}
    </div>
  );
}
