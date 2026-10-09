import { cn } from "@/lib/utils";

type Props = {
  children: React.ReactNode;
  className?: string;
  /** id do título (visível ou não) que dá nome à região para o leitor de tela */
  labelledBy?: string;
  "data-testid"?: string;
};

// O "painel elétrico" (ADR-008, M07.2): o único destaque de cada página. Azul com o brilho lima
// no canto. Uma página tem no máximo um; tudo em volta fica sólido e quieto.
// Texto dentro dele usa text-hero-foreground (branco); valores em reais com
// <AmountText tone="inherit"> (verde e vermelho não passam no contraste sobre o azul).
export function HeroPanel({ children, className, labelledBy, ...rest }: Props) {
  return (
    <section
      aria-labelledby={labelledBy}
      className={cn(
        "bg-hero text-hero-foreground relative isolate overflow-hidden rounded-3xl p-5 shadow-[0_18px_40px_-18px_rgb(47_91_255/0.55)] md:p-7",
        className,
      )}
      {...rest}
    >
      {/* O brilho: decorativo, fora da árvore de acessibilidade */}
      <span
        aria-hidden
        className="bg-highlight pointer-events-none absolute -top-36 -right-36 -z-10 size-72 rounded-full opacity-30 blur-3xl"
      />
      <span
        aria-hidden
        className="pointer-events-none absolute -bottom-28 -left-20 -z-10 size-56 rounded-full bg-white opacity-10 blur-3xl"
      />
      {children}
    </section>
  );
}

// Um número dentro do painel (entradas, saídas...): fundo azul mais escuro, sem borda. Mais
// claro (branco translúcido) reprovou no axe: o texto branco caía abaixo de 4,5:1.
export function HeroStat({
  label,
  children,
  className,
  ...rest
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
  "data-testid"?: string;
}) {
  return (
    <div
      className={cn(
        "min-w-0 rounded-2xl bg-[rgb(10_13_40/0.24)] px-3 py-2.5 sm:px-3.5 sm:py-3",
        className,
      )}
      {...rest}
    >
      <p className="text-sm opacity-90">{label}</p>
      <div className="mt-0.5 text-[0.95rem] font-semibold sm:text-lg">{children}</div>
    </div>
  );
}
