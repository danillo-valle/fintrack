"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Plus } from "lucide-react";

const HREF = "/lancamentos/novo";

// Botão flutuante do celular: a ação mais frequente a um toque, no alcance do polegar.
// Some na própria tela de novo lançamento, onde seria redundante.
export function NewTransactionFab() {
  const pathname = usePathname();
  if (pathname === HREF) return null;

  return (
    <Link
      href={HREF}
      aria-label="Novo lançamento"
      className="bg-primary text-primary-foreground focus-visible:ring-ring fixed right-4 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-40 flex size-14 items-center justify-center rounded-2xl shadow-[0_10px_24px_rgb(47_91_255/0.35)] outline-none focus-visible:ring-4 md:hidden"
    >
      <Plus aria-hidden className="size-6" />
    </Link>
  );
}
