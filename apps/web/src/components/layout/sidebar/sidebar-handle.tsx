"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useSidebar } from "./sidebar-provider";

// A alça discreta na borda do menu: recolhe até ficarem só os ícones, ou abre de novo. O nome do
// botão diz o que ele faz agora, então o leitor de tela sabe o estado sem olhar. 28 px: no
// computador (ponteiro preciso) passa no mínimo de 24 px da WCAG 2.2.
export function SidebarHandle({ controls }: { controls: string }) {
  const { state, toggle } = useSidebar();
  const collapsed = state === "collapsed";
  const Icon = collapsed ? ChevronRight : ChevronLeft;
  return (
    <button
      type="button"
      onClick={toggle}
      aria-controls={controls}
      aria-label={collapsed ? "Expandir menu" : "Recolher menu"}
      title={collapsed ? "Expandir menu" : "Recolher menu"}
      className="bg-card text-foreground focus-visible:ring-ring absolute top-6 -right-3.5 z-10 grid size-7 cursor-pointer place-items-center rounded-full border shadow-[0_4px_14px_rgb(10_13_40/0.18)] outline-none focus-visible:ring-3"
    >
      <Icon aria-hidden className="size-4" />
    </button>
  );
}
