import Link from "next/link";

// Marca do app: o mesmo desenho do ícone instalado no celular
export function Brand() {
  return (
    <Link
      href="/"
      className="focus-visible:ring-ring flex items-center gap-2 rounded-lg font-semibold tracking-tight outline-none focus-visible:ring-3"
    >
      <svg aria-hidden viewBox="0 0 32 32" className="size-7">
        <rect width="32" height="32" rx="8" className="fill-hero" />
        <path d="M10 8h13v4H14v3h7v4h-7v5h-4z" className="fill-hero-foreground" />
        <circle cx="23" cy="22" r="2.5" className="fill-highlight" />
      </svg>
      <span>FinTrack</span>
    </Link>
  );
}
