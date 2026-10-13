import { cn } from "@/lib/utils";

// Barra de uso (M09.1): o limite do cartão já usado. A barra é imagem com nome acessível; o valor
// disponível vem escrito ao lado, então a barra nunca é o único sinal.
export function Meter({
  used,
  total,
  label,
  className,
}: {
  used: bigint;
  total: bigint;
  /** "Limite usado: 23,6 %. Disponível R$ 6.115,10 de R$ 8.000,00." */
  label: string;
  className?: string;
}) {
  // Porcentagem em décimos, sem number de dinheiro: (usado × 1000) ÷ total, entre 0 e 1000
  const permille = total > 0n ? Math.min(1000, Math.max(0, Number((used * 1000n) / total))) : 0;
  return (
    <span
      role="img"
      aria-label={label}
      className={cn("bg-muted block h-2 overflow-hidden rounded-full", className)}
    >
      <span
        className="bg-chart-1 block h-full rounded-full"
        style={{ width: `${permille / 10}%` }}
      />
    </span>
  );
}

/** "23,6 %" do limite usado, para o nome acessível da barra. */
export function usedPercentLabel(used: bigint, total: bigint): string {
  if (total <= 0n) return "0 %";
  const permille = (used * 1000n) / total;
  return `${permille / 10n},${permille % 10n} %`;
}
