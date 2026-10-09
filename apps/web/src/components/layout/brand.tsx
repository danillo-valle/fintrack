import Link from "next/link";
import { cn } from "@/lib/utils";

// Marca do app: o mesmo desenho do ícone instalado no celular.
// collapsible: no menu lateral recolhido, fica só o desenho (o nome segue para o leitor de tela).
export function Brand({
  collapsible = false,
  className,
}: {
  collapsible?: boolean;
  className?: string;
}) {
  return (
    <Link
      href="/"
      className={cn(
        "focus-visible:ring-ring flex items-center gap-2 rounded-lg font-semibold tracking-tight outline-none focus-visible:ring-3",
        className,
      )}
    >
      <svg aria-hidden viewBox="0 0 32 32" className="size-7">
        <rect width="32" height="32" rx="8" className="fill-hero" />
        <path d="M10 8h13v4H14v3h7v4h-7v5h-4z" className="fill-hero-foreground" />
        <circle cx="23" cy="22" r="2.5" className="fill-highlight" />
      </svg>
      <span className={collapsible ? "collapsed:sr-only" : undefined}>FinTrack</span>
    </Link>
  );
}
