import { ListSkeleton } from "@/components/feedback/list-skeleton";
import { Skeleton } from "@/components/ui/skeleton";

// Mostrado automaticamente pelo Next.js enquanto uma página do grupo carrega.
// Placeholders com desfoque no formato da página: título, cartão de destaque e lista.
export default function Loading() {
  return (
    <div className="flex flex-col gap-6">
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-24 w-full rounded-2xl" />
      <ListSkeleton />
    </div>
  );
}
