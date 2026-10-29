// Os diagramas do C4 (docs/arquitetura/c4.md) viram SVG no build, desenhados pelo próprio Mermaid
// num Chromium sem rede. Um diagrama com erro de sintaxe para o build: o site nunca sai com uma
// imagem quebrada, e o mesmo texto é o que o GitHub desenha no c4.md.
import { createRequire } from "node:module";
import { chromium } from "@playwright/test";

const require = createRequire(import.meta.url);

/** O texto que vai para o SVG do site: sem o <b> (o rótulo em SVG puro mostraria a marca). */
export function forSvg(mermaid: string): string {
  return mermaid.replace(/<\/?b>/g, "");
}

type MermaidApi = {
  initialize(config: Record<string, unknown>): void;
  render(id: string, text: string): Promise<{ svg: string }>;
};

/**
 * O Mermaid sai com width="100%" e a largura num style: como imagem (<img>), isso não dá um
 * tamanho natural. Troca por width e height do próprio viewBox, para a página reservar o espaço.
 */
export function withSize(svg: string): string {
  const box = /viewBox="[\d.-]+ [\d.-]+ ([\d.]+) ([\d.]+)"/.exec(svg);
  if (!box) throw new Error("o SVG do Mermaid veio sem viewBox");
  const width = Math.ceil(Number(box[1]));
  const height = Math.ceil(Number(box[2]));
  return svg.replace(
    /^<svg([^>]*?) width="100%"([^>]*?) style="max-width: [\d.]+px;"/,
    `<svg$1 width="${width}" height="${height}"$2`,
  );
}

/** A largura e a altura que o withSize gravou (para o <img> da página). */
export function sizeOf(svg: string): { width: number; height: number } {
  const m = /^<svg[^>]*? width="(\d+)" height="(\d+)"/.exec(svg);
  if (!m) throw new Error("o SVG não tem width e height");
  return { width: Number(m[1]), height: Number(m[2]) };
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
