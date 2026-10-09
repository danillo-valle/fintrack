import { cn } from "@/lib/utils";

// Lista agrupada (M07.2): um bloco branco com as linhas juntas, separadas por um fio.
// É o padrão para qualquer lista do app (lançamentos, carteiras, contas, sessões, ajustes).
export function SurfaceList({ children, className, ...rest }: React.ComponentProps<"ul">) {
  return (
    <ul className={cn("bg-card divide-y overflow-hidden rounded-2xl border", className)} {...rest}>
      {children}
    </ul>
  );
}

type RowProps = {
  /** Ícone colorido ou avatar à esquerda */
  leading?: React.ReactNode;
  /** O nome da linha (pode ser um link) */
  title: React.ReactNode;
  /** Uma linha de detalhes embaixo do nome */
  meta?: React.ReactNode;
  /** Valor, etiqueta ou ação à direita */
  trailing?: React.ReactNode;
  className?: string;
};

export function SurfaceRow({ leading, title, meta, trailing, className }: RowProps) {
  return (
    <li className={cn("flex min-h-16 items-center gap-3 px-4 py-3", className)}>
      {leading}
      <div className="min-w-0 flex-1">
        <div className="font-medium break-words">{title}</div>
        {meta ? <div className="text-muted-foreground text-sm">{meta}</div> : null}
      </div>
      {trailing}
    </li>
  );
}
