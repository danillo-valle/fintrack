// Os diagramas do C4 (docs/arquitetura/c4.md) viram SVG no build, desenhados pelo próprio Mermaid
// num Chromium sem rede. Um diagrama com erro de sintaxe para o build: o site nunca sai com uma
// imagem quebrada, e o mesmo texto é o que o GitHub desenha no c4.md.
import { createRequire } from "node:module";
import { chromium } from "@playwright/test";

const require = createRequire(import.meta.url);

/**
 * O texto que vai para o SVG do site: sem o <b> (o rótulo em SVG puro mostraria a marca). Não é
 * uma limpeza de segurança: o Mermaid desenha em modo strict e com rótulos em SVG puro (texto).
 */
export function forSvg(mermaid: string): string {
  return mermaid.replace(/<\/?b>/g, "");
}

type MermaidApi = {
  initialize(config: Record<string, unknown>): void;
  render(id: string, text: string): Promise<{ svg: string }>;
};

/** A tag de abertura do SVG ("<svg ...>"), lida até o primeiro ">" (sem regex sobre o SVG). */
function openingTag(svg: string): string {
  const end = svg.indexOf(">");
  if (!svg.startsWith("<svg ") || end === -1) throw new Error("o Mermaid não devolveu um <svg>");
  return svg.slice(0, end);
}

/** O valor de um atributo da tag (só a primeira ocorrência de ` nome="`), ou null. */
function attribute(tag: string, name: string): string | null {
  const start = tag.indexOf(` ${name}="`);
  if (start === -1) return null;
  const from = start + name.length + 3;
  const end = tag.indexOf('"', from);
  return end === -1 ? null : tag.slice(from, end);
}

/** Tira ` nome="…"` da tag, quando o valor é o esperado; a tag igual, se não for. */
function withoutAttribute(tag: string, name: string, accept: (value: string) => boolean): string {
  const value = attribute(tag, name);
  if (value === null || !accept(value)) return tag;
  const piece = ` ${name}="${value}"`;
  const at = tag.indexOf(piece);
  return tag.slice(0, at) + tag.slice(at + piece.length);
}

/**
 * O Mermaid sai com width="100%" e a largura num style: como imagem (<img>), isso não dá um
 * tamanho natural. Troca por width e height do próprio viewBox, para a página reservar o espaço.
 * A tag é lida por posição, não por regex (um SVG estranho não deixa o build lento).
 */
export function withSize(svg: string): string {
  const tag = openingTag(svg);
  const box = (attribute(tag, "viewBox") ?? "").split(" ").map(Number);
  const [, , boxWidth, boxHeight] = box;
  if (box.length !== 4 || !box.every(Number.isFinite) || !boxWidth || !boxHeight)
    throw new Error("o SVG do Mermaid veio sem viewBox");
  const size = ` width="${Math.ceil(boxWidth)}" height="${Math.ceil(boxHeight)}"`;
  // O tamanho entra onde estava o width="100%" (ou no fim da tag), e o max-width do style sai
  const full = ' width="100%"';
  const at = tag.indexOf(full);
  let next = at === -1 ? tag + size : tag.slice(0, at) + size + tag.slice(at + full.length);
  next = withoutAttribute(next, "style", (v) => /^max-width: [\d.]+px;$/.test(v));
  return next + svg.slice(tag.length);
}

/** A largura e a altura que o withSize gravou (para o <img> da página). */
export function sizeOf(svg: string): { width: number; height: number } {
  const tag = openingTag(svg);
  const width = Number(attribute(tag, "width"));
  const height = Number(attribute(tag, "height"));
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0)
    throw new Error("o SVG não tem width e height");
  return { width, height };
}

export async function renderDiagrams(
  sources: { id: string; mermaid: string }[],
): Promise<Map<string, string>> {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    // Nada sai para a rede: o Mermaid vem do node_modules
    await page.route("**/*", (route) => route.abort());
    await page.setContent("<!doctype html><html><body></body></html>");
    await page.addScriptTag({ path: require.resolve("mermaid/dist/mermaid.min.js") });
    const out = new Map<string, string>();
    for (const { id, mermaid } of sources) {
      const svg = await page.evaluate(
        async ([diagramId, text]) => {
          const api = (window as unknown as { mermaid: MermaidApi }).mermaid;
          api.initialize({
            startOnLoad: false,
            securityLevel: "strict",
            theme: "base",
            // Rótulos em SVG puro: a imagem não depende de HTML dentro do SVG (foreignObject)
            htmlLabels: false,
            flowchart: { htmlLabels: false, padding: 14, wrappingWidth: 240 },
            themeVariables: {
              // A imagem não carrega fonte de fora: as do sistema. Sem o system-ui, que em alguns
              // Linux aponta para uma fonte serifada
              fontFamily: "-apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
              fontSize: "15px",
              lineColor: "#535C78",
              edgeLabelBackground: "#FFFFFF",
              clusterBkg: "#F6F8FE",
              clusterBorder: "#8C95B0",
              titleColor: "#0E1325",
            },
          });
          const { svg: rendered } = await api.render(diagramId, text);
          return rendered;
        },
        [id, forSvg(mermaid)] as const,
      );
      if (!svg.includes("<svg") || /Syntax error/i.test(svg)) {
        throw new Error(`o diagrama ${id} não desenhou (confira o Mermaid no c4.md)`);
      }
      out.set(id, withSize(svg));
    }
    return out;
  } finally {
    await browser.close();
  }
}
