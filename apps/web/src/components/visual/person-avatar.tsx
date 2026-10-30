import { cn } from "@/lib/utils";

const SIZE = {
  sm: "size-[1.625rem] text-[0.6875rem]",
  md: "size-9 text-[0.8125rem]",
  lg: "size-[3.25rem] text-lg",
};

// As iniciais de uma pessoa num círculo, na cor dela no "Pago por" (M13.1, prancha L): quem usa
// um cartão e quem está na sessão. O texto é a "tinta" do tom (--chart-N-ink) sobre o próprio tom
// a 16 %, o mesmo par do PayerTile (4,5:1 no theme-contrast.test.ts). Decorativo por padrão: o
// nome está sempre escrito ao lado ou no nome acessível do botão.
export function PersonAvatar({
  initials,
  tone,
  size = "md",
  className,
}: {
  initials: string;
  tone: 1 | 2 | 3 | 4 | 5;
  size?: keyof typeof SIZE;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      style={
        {
          "--tone": `var(--chart-${tone})`,
          "--tone-ink": `var(--chart-${tone}-ink)`,
        } as React.CSSProperties
      }
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full bg-[color-mix(in_srgb,var(--tone)_16%,transparent)] font-extrabold tracking-[0.02em] text-[var(--tone-ink)]",
        SIZE[size],
        className,
      )}
    >
      {initials}
    </span>
  );
}
