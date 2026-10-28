// O corpo de um artigo da Ajuda (M12.3a): o mesmo na página, no modal do "?" e na página pública
// do primeiro acesso. Texto vem de content.ts; o único enfeite é o **negrito**, que vira <strong>
// (nada de HTML vindo do conteúdo).
import type { ReactNode } from "react";
import type { HelpArticle, HelpBlock } from "../content";

/** "Toque em **Salvar**." → ["Toque em ", <strong>Salvar</strong>, "."] */
export function rich(text: string): ReactNode[] {
  return text.split("**").map((part, i) => (i % 2 === 1 ? <strong key={i}>{part}</strong> : part));
}

function Block({ block, idPrefix, index }: { block: HelpBlock; idPrefix: string; index: number }) {
  switch (block.kind) {
    case "p":
      return <p>{rich(block.text)}</p>;
    case "h":
      return (
        <h3 id={`${idPrefix}h${index}`} className="text-lg font-extrabold">
          {block.text}
        </h3>
      );
    case "steps":
      return (
        <ol className="flex list-decimal flex-col gap-1.5 pl-6">
          {block.items.map((item) => (
            <li key={item}>{rich(item)}</li>
          ))}
        </ol>
      );
    case "list":
      return (
        <ul className="flex list-disc flex-col gap-1.5 pl-6">
          {block.items.map((item) => (
            <li key={item}>{rich(item)}</li>
          ))}
        </ul>
      );
    case "faq":
      return (
        <details className="rounded-xl border px-3.5 py-3">
          <summary className="focus-visible:ring-ring cursor-pointer rounded font-bold outline-none focus-visible:ring-3">
            {block.q}
          </summary>
          <p className="mt-2">{rich(block.a)}</p>
        </details>
      );
  }
}

export function ArticleBody({
  article,
  idPrefix = "",
}: {
  article: HelpArticle;
  /** Prefixo dos ids dos subtítulos (o modal e a página nunca convivem, mas o padrão do app é esse) */
  idPrefix?: string;
}) {
  return (
    <div className="flex flex-col gap-4 text-[0.9375rem] leading-relaxed">
      {article.body.map((block, i) => (
        <Block key={i} block={block} idPrefix={idPrefix} index={i} />
      ))}
    </div>
  );
}
