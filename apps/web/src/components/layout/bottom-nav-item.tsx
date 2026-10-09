"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { isActive } from "./nav-items";

// Um item da barra inferior: ícone em cima, nome embaixo. Cliente por causa do usePathname.
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
        active ? "text-primary font-bold" : "text-muted-foreground",
      )}
    >
      {icon}
      <span>{label}</span>
    </Link>
  );
}
