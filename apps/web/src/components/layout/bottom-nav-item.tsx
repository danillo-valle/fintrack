"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { isActive } from "./nav-items";

// Um item da barra inferior: ícone em cima, nome embaixo. Cliente por causa do usePathname.
// O escolhido: o nome em negrito na cor do texto e o ícone na cor primária. O nome não fica na
// cor primária porque a barra é de vidro: com um botão azul passando por baixo, o azul do texto
// cairia abaixo de 4,5:1 (o axe pegou no M13.3a); o ícone só precisa de 3:1
// (theme-contrast.test.ts, "barra do celular de vidro").
export function BottomNavItem({
  href,
  label,
  icon,
}: {
  href: string;
  label: string;
  icon: React.ReactNode;
}) {
  const active = isActive(usePathname(), href);
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "focus-visible:ring-ring flex min-h-14 flex-col items-center justify-center gap-1 text-[0.7rem] font-medium outline-none focus-visible:ring-3",
        active ? "text-foreground font-bold" : "text-muted-foreground",
      )}
    >
      <span className={cn("flex", active && "text-primary")}>{icon}</span>
      <span>{label}</span>
    </Link>
  );
}
