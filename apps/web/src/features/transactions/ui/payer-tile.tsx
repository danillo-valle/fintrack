import { cn } from "@/lib/utils";
import type { PayerOption } from "../payers";

// O quadrado de quem pagou (M07.4, canvas C.2): as iniciais (DV, NV, CP) na cor da pessoa. Não é
// decorativo como o IconTile: as iniciais SÃO a informação, então o quadrado tem nome para o
// leitor de tela ("Pago por Danillo") e a mesma frase como dica para o mouse. Por ser texto, a cor
// das letras é a "tinta" do tom (--chart-N-ink), que passa 4,5:1 sobre o próprio tom a 16 %.
export function PayerTile({
  payer,
  className,
}: {
  payer: Pick<PayerOption, "name" | "initials" | "tone">;
  className?: string;
}) {
  const label = `Pago por ${payer.name}`;
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      style={
        {
          "--tone": `var(--chart-${payer.tone})`,
          "--tone-ink": `var(--chart-${payer.tone}-ink)`,
        } as React.CSSProperties
      }
      className={cn(
        "inline-flex size-10 shrink-0 items-center justify-center rounded-xl bg-[color-mix(in_srgb,var(--tone)_16%,transparent)] text-sm font-bold tracking-[0.02em] text-[var(--tone-ink)]",
        className,
      )}
    >
      {payer.initials}
    </span>
  );
}
