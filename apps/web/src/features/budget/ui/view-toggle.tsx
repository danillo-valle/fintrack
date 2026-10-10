import Link from "next/link";
import { cn } from "@/lib/utils";

// "Gráfico | Tabela" (M08): a tabela é a alternativa em texto do gráfico (WCAG 1.1.1), com os
// mesmos números. A escolha vai para a URL (?ver=tabela), como os outros filtros.
// No celular (canvas D), no lugar das duas opções, um link só para a outra ("Tabela").
export function ViewToggle({
  current,
  hrefFor,
}: {
  current: "grafico" | "tabela";
  hrefFor: (view: "grafico" | "tabela") => string;
}) {
  const other = current === "grafico" ? "tabela" : "grafico";
  return (
    <>
      <Link
        href={hrefFor(other)}
        scroll={false}
        className="text-chart-1-ink text-sm font-semibold underline decoration-dotted underline-offset-4 hover:decoration-solid md:hidden"
      >
        {other === "tabela" ? "Tabela" : "Gráfico"}
      </Link>
      <ViewSegments current={current} hrefFor={hrefFor} />
    </>
  );
}

function ViewSegments({
  current,
  hrefFor,
}: {
  current: "grafico" | "tabela";
  hrefFor: (view: "grafico" | "tabela") => string;
}) {
  return (
    <nav
      aria-label="Ver como"
      className="bg-muted hidden gap-0.5 rounded-[0.625rem] p-[3px] md:inline-flex"
    >
      {(["grafico", "tabela"] as const).map((view) => (
        <Link
          key={view}
          href={hrefFor(view)}
          aria-current={current === view ? "true" : undefined}
          scroll={false}
          className={cn(
            "focus-visible:ring-ring grid h-9 place-items-center rounded-lg px-3 text-[0.8125rem] outline-none focus-visible:ring-3",
            current === view
              ? "bg-card font-bold shadow-[0_1px_3px_rgb(10_13_40/0.14)]"
              : "text-muted-foreground hover:text-foreground font-semibold",
          )}
        >
          {view === "grafico" ? "Gráfico" : "Tabela"}
        </Link>
      ))}
    </nav>
  );
}
