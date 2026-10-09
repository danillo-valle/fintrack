import Link from "next/link";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";

// "Novo lançamento" no cabeçalho das páginas principais, no computador (M07.3). Desde que saiu
// do menu lateral, é por aqui que ele fica a um clique em qualquer tela; no celular, quem faz
// esse papel é o botão flutuante (NewTransactionFab). Abre o modal (rota interceptada).
export function NewTransactionButton() {
  return (
    <Button
      asChild
      size="lg"
      className="hidden h-11 rounded-xl px-[1.125rem] font-bold md:inline-flex"
    >
      <Link href="/lancamentos/novo">
        <Plus aria-hidden />
        Novo lançamento
      </Link>
    </Button>
  );
}
