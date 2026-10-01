"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { isActive } from "./nav-items";

type Props = {
  href: string;
  label: string;
  variant: "sidebar" | "bottom";
  /** O ícone já desenhado (<House />). Um componente (House) não pode vir do servidor. */
  icon: React.ReactNode;
};

// Componente de cliente: precisa do usePathname, que só existe no navegador
export function NavLink({ href, label, variant, icon }: Props) {
  const pathname = usePathname();
  const active = isActive(pathname, href);

  return (
    <Link
      href={href}
      // aria-current avisa o leitor de tela qual é a página atual
      aria-current={active ? "page" : undefined}
      className={cn(
        "focus-visible:ring-ring outline-none focus-visible:ring-3",
        variant === "sidebar" &&
          "text-sidebar-foreground hover:bg-sidebar-accent flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium",
        variant === "sidebar" && active && "bg-sidebar-accent text-sidebar-accent-foreground",
        variant === "bottom" &&
          "text-muted-foreground flex min-h-14 flex-col items-center justify-center gap-1 text-[0.7rem] font-medium",
        variant === "bottom" && active && "text-primary",
      )}
    >
      {icon}
      <span>{label}</span>
    </Link>
  );
}
