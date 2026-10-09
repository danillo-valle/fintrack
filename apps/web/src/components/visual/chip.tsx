import Link from "next/link";
import { cn } from "@/lib/utils";

const BASE =
  "focus-visible:ring-ring inline-flex h-[2.375rem] shrink-0 items-center gap-1.5 rounded-full border px-4 text-sm font-semibold whitespace-nowrap outline-none focus-visible:ring-3 [&_svg]:size-4 [&_svg]:shrink-0";

// Chip (M07.2): atalho ou filtro rápido em forma de pílula. O ativo usa a lima com texto escuro
// e aria-current, para que o leitor de tela também saiba qual está escolhido.
export function ChipLink({
  href,
  active = false,
  children,
  className,
}: {
  href: string;
  active?: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "true" : undefined}
      className={cn(
        BASE,
        active
          ? "bg-highlight text-highlight-foreground border-transparent font-bold"
          : "bg-card hover:bg-muted text-foreground",
        className,
      )}
    >
      {children}
    </Link>
  );
}

export const CHIP_CLASS = cn(BASE, "bg-card hover:bg-muted text-foreground");
