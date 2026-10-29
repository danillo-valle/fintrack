// O mínimo de Markdown que o site lê dos documentos (os parágrafos e as listas do c4.md): negrito,
// código, links. Tudo escapado antes; nada de HTML do documento passa para a página.
import { esc } from "./html";

function inline(text: string): string {
  return esc(text)
    .replace(/`([^`]+)`/g, '<code class="num">$1</code>')
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\[([^\]]+)\]\((https:\/\/[^)\s]+)\)/g, '<a href="$2">$1</a>');
}

/** Parágrafos e listas de "- ", com as linhas quebradas do Prettier juntadas de novo. */
export function markdownBlocks(text: string): string {
  const out: string[] = [];
  let list: string[] = [];
  let para: string[] = [];
  const flushPara = () => {
    if (para.length) out.push(`<p>${inline(para.join(" "))}</p>`);
    para = [];
  };
  const flushList = () => {
    if (list.length) out.push(`<ul>${list.map((li) => `<li>${inline(li)}</li>`).join("")}</ul>`);
    list = [];
  };
  for (const raw of text.split("\n")) {
    const line = raw.trimEnd();
    if (line.startsWith("- ")) {
      flushPara();
      list.push(line.slice(2));
    } else if (/^\s{2,}\S/.test(line) && list.length) {
      list[list.length - 1] += ` ${line.trim()}`;
    } else if (line.trim() === "") {
      flushPara();
      flushList();
    } else {
      flushList();
      para.push(line.trim());
    }
  }
  flushPara();
  flushList();
  return out.join("\n");
}

export type Section = { title: string; id: string; mermaid: string; notes: string };

/** As seções "## Nível N · ..." do c4.md: o título, o bloco mermaid e o texto que vem depois. */
export function c4Sections(markdown: string): Section[] {
  const parts = markdown.split(/^## /m).slice(1);
  return parts.flatMap((part) => {
    const [titleLine = "", ...rest] = part.split("\n");
    const body = rest.join("\n");
    const match = /```mermaid\n([\s\S]*?)```/.exec(body);
    if (!match) return [];
    const nivel = /Nível (\d)/.exec(titleLine)?.[1] ?? String(parts.indexOf(part) + 1);
    return [
      {
        title: titleLine.trim(),
        id: `c4-nivel-${nivel}`,
        mermaid: match[1] ?? "",
        notes: body.slice((match.index ?? 0) + match[0].length).trim(),
      },
    ];
  });
}
