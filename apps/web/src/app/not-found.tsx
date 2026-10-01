import Link from "next/link";
import { SearchX } from "lucide-react";
import { EmptyState } from "@/components/feedback/empty-state";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md items-center px-4">
      <h1 className="sr-only">Página não encontrada</h1>
      <EmptyState
        icon={SearchX}
        title="Esta página não existe"
        description="O endereço pode estar errado ou a página foi removida."
        action={
          <Button asChild>
            <Link href="/">Voltar ao início</Link>
          </Button>
        }
      />
    </main>
  );
}
