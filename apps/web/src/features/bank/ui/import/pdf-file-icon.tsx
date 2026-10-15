// O ícone do PDF da fatura (M09.4, linha E.4 do canvas): uma folha com "PD" desenhado, no
// mesmo traço dos ícones lucide. `PdfGlyph` é só o desenho; `PdfFileIcon`, o desenho num
// quadrado no tom pedido (o passo da senha e o resumo da conferência).
import { cn } from "@/lib/utils";

export function PdfGlyph({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5" />
      <path d="M8.5 16v-4h1.2a1.2 1.2 0 0 1 0 2.4H8.5M13 12v4h1a2 2 0 0 0 0-4z" />
    </svg>
  );
}

export function PdfFileIcon({ tone, className }: { tone: 1 | 5; className?: string }) {
  return (
    <span
      aria-hidden
      style={
        {
          "--tone": `var(--chart-${tone})`,
          "--ink": `var(--chart-${tone}-ink)`,
        } as React.CSSProperties
      }
      className={cn(
        "grid size-10 place-items-center rounded-xl bg-[color-mix(in_srgb,var(--tone)_14%,transparent)] text-[var(--ink)]",
        className,
      )}
    >
      <PdfGlyph className="size-5" />
    </span>
  );
}
