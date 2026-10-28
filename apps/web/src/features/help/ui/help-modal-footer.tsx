// O rodapé do modal de ajuda (prancha J-AjudaDaTela): "Abrir na Ajuda" leva à página inteira do
// artigo. É um <a> comum, que recarrega: assim o endereço não cai de novo no modal. Fechar é o X do
// próprio modal (RouteModal), que volta para a tela de baixo.
import { ArrowRight } from "lucide-react";
import { TEXT_LINK } from "@/lib/styles";

export function HelpModalFooter({ slug }: { slug: string }) {
  return (
    <a
      href={`/ajuda/${slug}`}
      className={`${TEXT_LINK} inline-flex min-h-10 items-center gap-1.5 font-bold`}
    >
      Abrir na Ajuda
      <ArrowRight aria-hidden className="size-4" />
    </a>
  );
}
