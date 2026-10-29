// O mínimo de Markdown que o site lê dos documentos (os parágrafos e as listas do c4.md): negrito,
// código, links. Tudo escapado antes; nada de HTML do documento passa para a página.
import { esc } from "./html";

/**
 * As posições de cada marca no texto, para achar "a próxima depois de i" sem varrer o texto de
 * novo a cada abertura (uma regex com /g fazia isso, e um texto com muitos "[" sem "]" ficava
 * lento: CodeQL js/polynomial-redos). Cada busca é uma busca binária.
 */
class Marks {
  private readonly at = new Map<string, number[]>();
  constructor(private readonly text: string) {}

  next(mark: string, from: number): number {
    let list = this.at.get(mark);
    if (!list) {
      list = [];
      for (let i = this.text.indexOf(mark); i !== -1; i = this.text.indexOf(mark, i + mark.length))
        list.push(i);
      this.at.set(mark, list);
    }
    let lo = 0;
    let hi = list.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if ((list[mid] as number) < from) lo = mid + 1;
      else hi = mid;
    }
    return lo < list.length ? (list[lo] as number) : -1;
  }

  /** O primeiro espaço em branco a partir de from (o link https termina antes dele). */
  nextSpace(from: number): number {
    return Math.min(
      ...[" ", "\t", "\n"].map((c) => this.next(c, from)).map((i) => (i === -1 ? Infinity : i)),
    );
  }
}

const LINK = "](https://";

/** `código`, **negrito** e [texto](https://…), num texto já escapado, numa passada só. */
function render(text: string, marks: Marks, start: number, end: number, links: boolean): string {
  let out = "";
  let i = start;
  while (i < end) {
    if (text[i] === "`") {
      const close = marks.next("`", i + 1);
      if (close > i + 1 && close < end) {
        out += `<code class="num">${text.slice(i + 1, close)}</code>`;
        i = close + 1;
        continue;
      }
    } else if (text.startsWith("**", i)) {
      const close = marks.next("**", i + 2);
      if (close > i + 2 && close + 2 <= end) {
        out += `<strong>${render(text, marks, i + 2, close, links)}</strong>`;
        i = close + 2;
        continue;
      }
    } else if (links && text[i] === "[") {
      // [texto](https://…): o texto sem "]" e o endereço sem ")" nem espaço, como no Markdown
      const label = marks.next(LINK, i + 1);
      const urlStart = label + 2;
      const close = label === -1 ? -1 : marks.next(")", urlStart);
      if (
        label > i + 1 &&
        marks.next("]", i + 1) === label &&
        close > urlStart + "https://".length &&
        close < end &&
        close < marks.nextSpace(urlStart)
      ) {
        out += `<a href="${text.slice(urlStart, close)}">${render(text, marks, i + 1, label, false)}</a>`;
        i = close + 1;
        continue;
      }
    }
    out += text[i];
    i += 1;
  }
  return out;
}

function inline(text: string): string {
  const escaped = esc(text);
  return render(escaped, new Marks(escaped), 0, escaped.length, true);
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
