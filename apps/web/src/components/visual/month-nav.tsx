import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

// Navegar entre meses (M08, canvas D): ‹ Outubro de 2026 ›. Os botões são links (o mês vai para
// a URL); o nome de cada um diz para onde vai ("Setembro de 2026"), não só "anterior".
export function MonthNav({
  label,
  prev,
  next,
  className,
}: {
  label: string;
  prev: { href: string; label: string };
  next: { href: string; label: string };
  className?: string;
}) {
  const button =
    "focus-visible:ring-ring hover:bg-muted grid size-11 place-items-center rounded-[0.5625rem] outline-none focus-visible:ring-3 md:size-10";
  return (
    <nav
      aria-label="Mês"
      className={cn(
        "bg-card flex items-center justify-between gap-1 rounded-xl border p-0.5 md:p-1",
        className,
      )}
    >
      <Link href={prev.href} aria-label={prev.label} className={button}>
        <ChevronLeft aria-hidden className="size-[1.125rem]" />
      </Link>
      <span className="min-w-40 text-center text-[0.9375rem] font-bold">{label}</span>
      <Link href={next.href} aria-label={next.label} className={button}>
        <ChevronRight aria-hidden className="size-[1.125rem]" />
      </Link>
    </nav>
  );
}
