import Link from "next/link";
import { SearchX } from "lucide-react";
import { EmptyState } from "@/components/feedback/empty-state";
import { Button } from "@/components/ui/button";

// 404 de dentro do app (M06): aparece quando uma página do grupo (app) chama notFound(), por
// exemplo /carteiras/<id de outra pessoa>. Fica dentro da casca (menu e barra de baixo), que
// já tem o <main>. O 404 da raiz (src/app/not-found.tsx) tem o próprio <main>; usado aqui, a
// página ficaria com dois <main>, e o axe reprova.
//
// O texto é o mesmo para "não existe" e "não é sua": a página não confirma que o id existe.
export default function AppNotFound() {
  return (
    <>
      <h1 className="sr-only">Página não encontrada</h1>
      <EmptyState
        icon={SearchX}
        title="Esta página não existe"
        description="O endereço pode estar errado, a página foi removida ou você não tem acesso a ela."
        action={
          <Button asChild>
            <Link href="/">Voltar ao início</Link>
          </Button>
        }
      />
    </>
  );
}
