// Estado do menu lateral (M07.2): aberto ou recolhido, guardado num cookie para o servidor já
// desenhar a página do jeito certo (sem o menu "pular" depois que o JavaScript carrega).
export const SIDEBAR_COOKIE = "fintrack-sidebar";

export type SidebarState = "expanded" | "collapsed";

export function parseSidebarState(value: string | undefined): SidebarState {
  return value === "collapsed" ? "collapsed" : "expanded";
}
