import { ListSkeleton } from "@/components/feedback/list-skeleton";
import { Skeleton } from "@/components/ui/skeleton";

// Mostrado automaticamente pelo Next.js enquanto uma página do grupo carrega
export default function Loading() {
  return (
    <div>
      <Skeleton className="mb-8 h-8 w-48" />
      <ListSkeleton />
    </div>
  );
}
