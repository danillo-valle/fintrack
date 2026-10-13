// O aviso do Início (M09.1, prancha E-Inicio): quantos lançamentos chegaram do banco e esperam
// revisão. Eles ficam FORA das somas até a revisão (M09.2); o link abre a lista dos recebidos.
import Link from "next/link";
import { ChevronRight, CircleDashed } from "lucide-react";

export function ReceivedBanner({ count, uncategorized }: { count: number; uncategorized: number }) {
  if (count === 0) return null;
  const title =
    count === 1 ? "1 lançamento recebido do banco" : `${count} lançamentos recebidos do banco`;
  return (
    <Link
      href="/lancamentos?situacao=recebidos"
      data-testid="aviso-recebidos"
      className="focus-visible:ring-ring grid grid-cols-[1.5rem_minmax(0,1fr)_1.25rem] items-center gap-2.5 rounded-2xl border bg-[color-mix(in_srgb,var(--chart-4)_14%,transparent)] px-3.5 py-3 outline-none focus-visible:ring-3 md:px-4 md:py-3.5"
    >
      <CircleDashed aria-hidden className="text-chart-4-ink size-5" />
      <span className="flex min-w-0 flex-col gap-0.5">
        <strong className="text-[0.9375rem]">{title}</strong>
        <span className="text-sm">
          Ficam em Recebidos e ainda não entram nas somas abaixo.
          {uncategorized > 0 ? ` ${uncategorized} sem categoria.` : ""}
        </span>
      </span>
      <ChevronRight aria-hidden className="size-[1.125rem]" />
    </Link>
  );
}
