// O HTML do site "FinTrack por dentro": um molde só para as páginas (topo, conteúdo, rodapé), com
// a CSP numa meta (o GitHub Pages não deixa mandar cabeçalhos) e nada vindo de fora do site.

/** Escapa texto para dentro do HTML (conteúdo e atributos). */
export function esc(text: string | number): string {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Só o próprio site: nenhum script, estilo, fonte ou imagem de fora, nada inline. Sem
 * frame-ancestors (não vale em meta); o site não tem dado de ninguém para proteger de um iframe.
 */
export const CSP =
  "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; font-src 'self'; " +
  "connect-src 'self'; base-uri 'none'; form-action 'none'";

export type PageId = "visao" | "fluxo" | "quem-usa";

export const NAV: { id: PageId; href: string; label: string }[] = [
  { id: "visao", href: "./", label: "Visão geral" },
  { id: "fluxo", href: "fluxo.html", label: "Mapa do fluxo" },
  { id: "quem-usa", href: "quem-usa.html", label: "Quem usa" },
];

export type SiteInfo = {
  /** dono/repositório no GitHub, para os links do código e dos documentos */
  repo: string;
  /** o commit de onde o site saiu */
  commit: string;
};

export const githubUrl = (info: SiteInfo, path = "") =>
  `https://github.com/${info.repo}${path ? `/blob/main/${path}` : ""}`;

const ICON_GIT =
  '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 3v12M18 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM18 9c0 6-12 3-12 9"/></svg>';

export function layout(opts: {
  info: SiteInfo;
  page: PageId;
  title: string;
  description: string;
  main: string;
  script?: boolean;
}): string {
  const { info, page } = opts;
  const nav = NAV.map((item) =>
    item.id === page
      ? `<a href="${item.href}" aria-current="page">${esc(item.label)}</a>`
      : `<a href="${item.href}">${esc(item.label)}</a>`,
  ).join("");
  return `<!doctype html>
<html lang="pt-BR" data-repo="${esc(info.repo)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="${CSP}">
<meta name="referrer" content="no-referrer">
<meta name="description" content="${esc(opts.description)}">
<title>${esc(opts.title)} · FinTrack por dentro</title>
<link rel="icon" href="favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="site.css">
${opts.script ? '<script type="module" src="app.js"></script>\n' : ""}</head>
<body data-page="${page}">
<a class="skip" href="#conteudo">Pular para o conteúdo</a>
<header class="topo">
<a class="marca" href="./"><span class="logo" aria-hidden="true"></span>FinTrack <span class="sub">por dentro</span></a>
<nav aria-label="Seções">${nav}<a href="${githubUrl(info)}">${ICON_GIT}GitHub</a></nav>
</header>
<main id="conteudo">
${opts.main}
</main>
<footer class="rodape">
<span>Gerado do código no commit <a class="num" href="https://github.com/${info.repo}/commit/${esc(info.commit)}">${esc(info.commit.slice(0, 7))}</a> pelo <span class="num">packages/flow-map</span>.</span>
<span>Nenhum dado de pessoa: só nomes de telas, funções e tabelas.</span>
</footer>
</body>
</html>
`;
}
