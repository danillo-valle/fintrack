// A busca da Ajuda (M12.3a, prancha J-Ajuda): pura, sem acento e sem diferença de maiúsculas,
// feita no servidor a partir de ?q= (funciona antes do React, como os filtros da lista).
import {
  articleText,
  HELP_ARTICLES,
  HELP_TOPICS,
  type HelpArticle,
  type HelpTopicId,
} from "./content";

export const HELP_QUERY_MAX = 60;

/** "Fatúra" → "fatura": tira acentos e caixa, para comparar. */
export function normalize(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

/** As palavras da busca (2 letras ou mais), já normalizadas. */
export function queryTerms(query: string): string[] {
  return normalize(query.slice(0, HELP_QUERY_MAX))
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length >= 2)
    .slice(0, 6);
}

export type SnippetPart = { text: string; mark: boolean };

export type HelpResult = {
  slug: string;
  title: string;
  topic: string;
  snippet: SnippetPart[];
};

/**
 * Um trecho do texto em volta da primeira palavra achada, com as palavras marcadas. Procura no
 * texto normalizado e marca no original: guarda, para cada letra normalizada, de onde ela veio.
 */
export function snippetFor(text: string, terms: readonly string[], radius = 70): SnippetPart[] {
  // Normaliza letra por letra, guardando de onde veio cada caractere normalizado
  let norm = "";
  const origin: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const n = normalize(text[i]!);
    for (let k = 0; k < n.length; k++) {
      norm += n[k];
      origin.push(i);
    }
  }
  const hits: [number, number][] = [];
  for (const term of terms) {
    let from = 0;
    for (;;) {
      const at = norm.indexOf(term, from);
      if (at < 0) break;
      // Marca a palavra inteira: "fatura" em "faturas" marca "faturas"
      let end = origin[at + term.length - 1]! + 1;
      while (end < text.length && /[\p{L}\p{N}]/u.test(text[end]!)) end++;
      hits.push([origin[at]!, end]);
      from = at + term.length;
    }
  }
  if (hits.length === 0) return [{ text: clip(text, 0, radius * 2), mark: false }];
  hits.sort((a, b) => a[0] - b[0]);
  const first = hits[0]![0];
  const start = Math.max(0, wordStart(text, first - radius));
  const end = Math.min(text.length, wordEnd(text, first + radius));
  const parts: SnippetPart[] = [];
  let cursor = start;
  for (const [a, b] of hits) {
    if (a < cursor || b > end) continue;
    if (a > cursor) parts.push({ text: text.slice(cursor, a), mark: false });
    parts.push({ text: text.slice(a, b), mark: true });
    cursor = b;
  }
  if (cursor < end) parts.push({ text: text.slice(cursor, end), mark: false });
  if (start > 0) parts.unshift({ text: "… ", mark: false });
  if (end < text.length) parts.push({ text: " …", mark: false });
  return parts;
}

function wordStart(text: string, at: number) {
  if (at <= 0) return 0;
  const space = text.lastIndexOf(" ", at);
  return space < 0 ? 0 : space + 1;
}

function wordEnd(text: string, at: number) {
  if (at >= text.length) return text.length;
  const space = text.indexOf(" ", at);
  return space < 0 ? text.length : space;
}

function clip(text: string, start: number, length: number) {
  return text.length <= start + length
    ? text.slice(start)
    : `${text.slice(start, wordEnd(text, start + length))} …`;
}

const TOPIC_TITLE = new Map<HelpTopicId, string>(HELP_TOPICS.map((t) => [t.id, t.title]));

/**
 * Os artigos que têm TODAS as palavras da busca, os com a palavra no título primeiro. O trecho
 * vem do corpo (sem o título), linha por linha, para não juntar frases soltas.
 */
export function searchHelp(
  query: string,
  articles: readonly HelpArticle[] = HELP_ARTICLES,
): HelpResult[] {
  const terms = queryTerms(query);
  if (terms.length === 0) return [];
  const scored: { article: HelpArticle; score: number; line: string }[] = [];
  articles.forEach((article, index) => {
    const full = normalize(articleText(article));
    if (!terms.every((t) => full.includes(t))) return;
    const title = normalize(article.title);
    const inTitle = terms.filter((t) => title.includes(t)).length;
    const lines = articleText(article).split("\n").slice(1);
    const line = lines.find((l) => terms.some((t) => normalize(l).includes(t))) ?? article.summary;
    scored.push({ article, score: inTitle * 1000 - index, line });
  });
  scored.sort((a, b) => b.score - a.score);
  return scored.map(({ article, line }) => ({
    slug: article.slug,
    title: article.title,
    topic: TOPIC_TITLE.get(article.topic) ?? "",
    snippet: snippetFor(line, terms),
  }));
}
