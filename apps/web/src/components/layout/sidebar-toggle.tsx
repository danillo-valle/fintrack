"use client";

import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SidebarLabel } from "./sidebar-label";
import { useSidebar } from "./shell-frame";

// Recolhe o menu lateral até ficarem só os ícones, ou abre de novo. O nome do botão diz o que
// ele vai fazer agora, para quem usa leitor de tela saber o estado sem olhar.
export function SidebarToggle() {
  const { state, toggle } = useSidebar();
  const collapsed = state === "collapsed";
  const Icon = collapsed ? PanelLeftOpen : PanelLeftClose;

  return (
    <Button
      type="button"
      variant="ghost"
      size="lg"
      onClick={toggle}
      aria-controls="menu-lateral"
      className="group/item collapsed:justify-center collapsed:px-0 relative w-full justify-start"
    >
      <Icon aria-hidden className="size-5" />
      <SidebarLabel>{collapsed ? "Expandir menu" : "Recolher menu"}</SidebarLabel>
    </Button>
  );
}
