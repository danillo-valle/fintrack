import { Skeleton } from "@/components/ui/skeleton";

// Esqueleto com o formato do conteúdo que vai chegar: a página não "pula" quando os dados aparecem.
// As formas ficam desfocadas e o aviso "Carregando…" aparece por cima, visível e lido pelo
// leitor de tela (role="status").
export function ListSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div role="status" aria-busy="true" className="relative">
      <div className="bg-card flex flex-col gap-4 rounded-xl border p-4">
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="flex items-center gap-3">
            <Skeleton className="size-10 rounded-full" />
            <div className="flex flex-1 flex-col gap-2">
              <Skeleton className="h-4 w-2/5" />
              <Skeleton className="h-3 w-1/4" />
            </div>
            <Skeleton className="h-4 w-20" />
          </div>
        ))}
      </div>
      <span className="glass absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border px-4 py-2 text-sm font-medium whitespace-nowrap">
        Carregando…
      </span>
    </div>
  );
}
