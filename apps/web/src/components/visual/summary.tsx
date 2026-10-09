import { cn } from "@/lib/utils";

// O resumo do topo de uma página (M07.3, adendo do ADR-008): uma faixa de cartões baixos.
// HighlightCard é o destaque (azul-claro, um por página); StatCard são os números ao lado, em
// cartões brancos. Substituem o painel azul cheio do M07.2, que ocupava meia tela.

/** A faixa: no computador, o destaque um pouco mais largo e os outros ao lado; no celular, o
 * destaque ocupa a linha inteira e os outros dividem a linha de baixo. */
export function SummaryGrid({
  label,
  children,
  className,
}: {
  /** Nome da região para o leitor de tela, por exemplo "Totais do filtro" */
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      aria-label={label}
      className={cn(
        "grid grid-cols-2 gap-2.5 md:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1fr)] md:gap-3.5",
        className,
      )}
    >
      {children}
    </section>
  );
}

const SOFT =
  "from-hero-soft to-hero-soft-2 border-hero-soft-border text-hero-soft-foreground relative isolate overflow-hidden rounded-[1.125rem] border bg-linear-135";

/** A superfície do destaque: azul-claro em degradê, com o brilho lima no canto. */
export function SoftPanel({
  children,
  className,
  labelledBy,
}: {
  children: React.ReactNode;
  className?: string;
  /** id do título que dá nome à região (vira uma <section>) */
  labelledBy?: string;
}) {
  const Tag = labelledBy ? "section" : "div";
  return (
    <Tag aria-labelledby={labelledBy} className={cn(SOFT, className)}>
      {/* O brilho: decorativo, fora da árvore de acessibilidade */}
      <span
        aria-hidden
        className="bg-highlight pointer-events-none absolute -top-14 -right-12 -z-10 size-36 rounded-full opacity-45 blur-[36px] dark:opacity-20"
      />
      {children}
    </Tag>
  );
}

/** O destaque do resumo: rótulo e valor. No celular, numa linha só e ocupando a linha inteira. */
export function HighlightCard({
  label,
  children,
  className,
  "data-testid": testId,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
  "data-testid"?: string;
}) {
  return (
    <div
      data-testid={testId}
      className={cn("col-span-2 flex md:col-span-1 [&>*]:flex-1", className)}
    >
      <SoftPanel className="flex items-baseline justify-between gap-3 px-4 py-3.5 md:flex-col md:items-start md:justify-start md:gap-0.5 md:px-5 md:py-4">
        <span className="text-[0.8125rem]">{label}</span>
        <span className="text-hero-soft-strong text-[1.375rem] font-bold md:text-2xl">
          {children}
        </span>
      </SoftPanel>
    </div>
  );
}

const STAT_TONE = {
  income: "bg-income/12 text-income",
  expense: "bg-expense/10 text-expense",
  neutral: "bg-muted text-muted-foreground",
} as const;

/** Um número ao lado do destaque, num cartão branco, com um ícone redondo opcional. */
export function StatCard({
  label,
  children,
  icon,
  tone = "neutral",
  className,
  "data-testid": testId,
}: {
  label: string;
  children: React.ReactNode;
  /** Ícone decorativo (aria-hidden), na cor do tom */
  icon?: React.ReactNode;
  tone?: keyof typeof STAT_TONE;
  className?: string;
  "data-testid"?: string;
}) {
  return (
    <div
      data-testid={testId}
      className={cn(
        "bg-card flex min-w-0 items-center justify-between gap-2.5 rounded-[1.125rem] border px-3.5 py-3 md:px-5 md:py-4",
        className,
      )}
    >
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="text-muted-foreground text-xs md:text-[0.8125rem]">{label}</span>
        <span className="text-base font-bold md:text-[1.375rem]">{children}</span>
      </div>
      {icon ? (
        <span
          aria-hidden
          className={cn(
            "hidden size-9 shrink-0 place-items-center rounded-full md:grid [&_svg]:size-[1.125rem]",
            STAT_TONE[tone],
          )}
        >
          {icon}
        </span>
      ) : null}
    </div>
  );
}
