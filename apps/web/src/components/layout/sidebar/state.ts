// Estado do menu lateral: aberto ou recolhido, guardado num cookie para o servidor já desenhar a
// página do jeito certo (sem o menu "pular" depois que o JavaScript carrega).
export const SIDEBAR_COOKIE = "fintrack-sidebar";

export type SidebarState = "expanded" | "collapsed";

export function parseSidebarState(value: string | undefined): SidebarState {
  return value === "collapsed" ? "collapsed" : "expanded";
}

/** O cookie que guarda a escolha por um ano. Só a preferência de tela, nenhum dado pessoal. */
export function sidebarCookie(state: SidebarState): string {
  return `${SIDEBAR_COOKIE}=${state}; path=/; max-age=31536000; samesite=lax`;
}
