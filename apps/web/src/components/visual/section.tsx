import { cn } from "@/lib/utils";

type Props = {
  id: string;
  title: string;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
};

// Seção de uma página (M07.2): bloco branco com título h2 e uma frase que explica para que serve.
// Substitui as constantes SECTION repetidas nas páginas.
export function Section({ id, title, description, actions, children, className }: Props) {
  return (
    <section
      aria-labelledby={id}
      className={cn("bg-card rounded-2xl border p-5 md:p-6", className)}
    >
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id={id} className="text-lg font-semibold tracking-tight">
            {title}
          </h2>
          {description ? <p className="text-muted-foreground mt-1 text-sm">{description}</p> : null}
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}
