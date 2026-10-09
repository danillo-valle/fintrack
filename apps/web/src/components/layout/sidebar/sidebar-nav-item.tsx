"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { isActive } from "../nav-items";
import { SidebarLabel } from "./sidebar-label";

// Um item do menu lateral. Aberto: ícone e nome. Recolhido: só o ícone, centralizado, e o nome
// vira dica (continua sendo o nome do link para o leitor de tela).
export function SidebarNavItem({
  href,
  label,
  icon,
}: {
  href: string;
  label: string;
  /** O ícone já desenhado: um componente não pode vir do servidor para o cliente */
  icon: React.ReactNode;
}) {
  const active = isActive(usePathname(), href);
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "group/item focus-visible:ring-sidebar-ring relative flex h-[2.625rem] items-center gap-3 rounded-xl px-3 text-sm outline-none focus-visible:ring-3",
        "collapsed:mx-auto collapsed:size-11 collapsed:justify-center collapsed:px-0",
        active
          ? "bg-sidebar-accent text-sidebar-accent-foreground font-bold"
          : "text-sidebar-muted-foreground hover:text-sidebar-foreground font-medium hover:bg-white/6",
      )}
    >
      {icon}
      <SidebarLabel>{label}</SidebarLabel>
    </Link>
  );
}
