// As três páginas do site (prancha K do canvas). A visão geral sai pronta do build (funciona sem
// JavaScript); o mapa do fluxo e o "quem usa" são montados no navegador a partir do fluxo.json.
import type { FlowMap } from "../model";
import { esc, githubUrl, layout, type SiteInfo } from "./html";
import { markdownBlocks, type Section } from "./markdown";

const ICON = (d: string, size = 18) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${d}"/></svg>`;
const I = {
  layers: "M12 3 2 8l10 5 10-5zM2 16l10 5 10-5M2 12l10 5 10-5",
  git: "M6 3v12M18 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM18 9c0 6-12 3-12 9",
  book: "M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2zM19 19v2H6",
  bolt: "M13 3 4 14h7l-1 7 9-11h-7z",
  ext: "M14 4h6v6M20 4l-9 9M18 14v5H5V6h5",
  search: "M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4",
};

export type Overview = {
  map: FlowMap;
  sections: Section[];
  /** a largura e a altura de cada SVG (para a página reservar o espaço da imagem) */
  sizes: Map<string, { width: number; height: number }>;
  adrs: number;
  reportAverage: string;
};

function stat(value: number, label: string, note: string): string {
  return `<div class="numero"><span class="num valor">${value}</span><strong>${esc(label)}</strong><span>${esc(note)}</span></div>`;
}

export function overviewPage(info: SiteInfo, o: Overview): string {
  const { map } = o;
  const pages = map.screens.filter((s) => s.kind === "page" || s.kind === "public").length;
  const modals = map.screens.filter((s) => s.kind === "modal").length;
  const stats = [
    stat(pages, "telas", `e ${modals} abertas em modal`),
    stat(map.actions.length, "ações do servidor", "Server Actions dos formulários"),
    stat(map.loaders.length, "carregamentos", "o que cada tela lê antes de abrir"),
    stat(map.queues.length, "filas", "pg-boss, no próprio Postgres"),
    stat(map.tables.length, "tabelas", `${map.db.length} funções do banco`),
    stat(
      map.services.length,
      "serviços de fora",
      map.services
        .map((s) => s.name.split(" (")[0])
        .slice(0, 3)
        .join(", ") + "…",
    ),
  ].join("");
  const diagrams = o.sections
    .map(
      (s) => `<section class="cartao c4" aria-labelledby="${s.id}">
<div class="cartao-topo"><h2 id="${s.id}">${esc(s.title.replace(/^Nível \d · /, ""))}</h2><span>C4, ${esc(s.title.split(" · ")[0]?.toLowerCase() ?? "")}</span></div>
<figure><img src="${s.id}.svg" width="${o.sizes.get(s.id)?.width ?? ""}" height="${o.sizes.get(s.id)?.height ?? ""}" alt="${esc(`Diagrama C4: ${s.title}. A explicação está logo abaixo e o diagrama em texto, no fim do cartão.`)}"></figure>
${markdownBlocks(s.notes)}
<details><summary>O diagrama em texto (Mermaid)</summary><pre class="num">${esc(s.mermaid.trim())}</pre></details>
</section>`,
    )
    .join("\n");
  const docs = [
    [
      I.book,
      "Decisões (ADRs)",
      `As ${o.adrs} decisões de arquitetura, revisadas antes da v1.0.0: o que vale, o que foi trocado e por quê.`,
      "docs/adr/README.md",
    ],
    [
      I.layers,
      "Relatório com nota",
      `Estrutura de pastas, modularização, escalabilidade, segurança, manutenção e refatoração. Média ${o.reportAverage}.`,
      "docs/arquitetura/relatorio.md",
    ],
    [
      I.bolt,
      "Runbook de incidente",
      "O que fazer quando algo cai: a gravidade, os primeiros 15 minutos, como avisar a casa e o pós-incidente.",
      "docs/operacao/incidente.md",
    ],
  ]
    .map(
      ([icon, title, desc, path]) => `<a class="doc" href="${githubUrl(info, path as string)}">
<span class="doc-titulo">${ICON(icon as string, 20)}<strong>${esc(title as string)}</strong></span>
<span>${esc(desc as string)}</span>
<span class="lnk">Ler no GitHub ${ICON(I.ext, 14)}</span></a>`,
    )
    .join("\n");
  const main = `<section class="abertura">
<h1>Como o FinTrack funciona por dentro</h1>
<p>Controle financeiro pessoal e da casa, feito em módulos como projeto de portfólio. Este site mostra a arquitetura e o caminho de cada tela até o banco, tirados do próprio código a cada versão.</p>
<div class="acoes"><a class="botao" href="fluxo.html">${ICON(I.layers)}Abrir o mapa do fluxo</a><a class="botao secundario" href="${githubUrl(info)}">${ICON(I.git)}Código no GitHub</a></div>
</section>
<div class="numeros">${stats}</div>
${diagrams}
<div class="docs">${docs}</div>`;
  return layout({
    info,
    page: "visao",
    title: "Visão geral",
    description: "A arquitetura do FinTrack em C4, os números e os documentos, gerados do código.",
    main,
  });
}

export function flowPage(info: SiteInfo): string {
  const main = `<div class="fluxo">
<nav class="telas" aria-label="Telas">
<label for="busca">Buscar tela, ação ou tabela</label>
<div class="busca">${ICON(I.search)}<input id="busca" type="search" placeholder="conta, /ajustes, FinancialAccount" autocomplete="off"></div>
<p id="busca-status" class="status" role="status"></p>
<div id="lista-telas"></div>
</nav>
<div class="tela-area">
<div class="tela-select"><label for="tela-select">Tela</label><select id="tela-select"></select></div>
<div id="tela"><p class="vazio">Carregando o mapa…</p></div>
<noscript><p>O mapa do fluxo precisa de JavaScript. Os mesmos dados estão em <a href="fluxo.json">fluxo.json</a>.</p></noscript>
</div>
</div>`;
  return layout({
    info,
    page: "fluxo",
    title: "Mapa do fluxo",
    description:
      "Cada tela do FinTrack: o que roda no navegador, o que chama no servidor, o que toca no banco e o que sai para fora.",
    main,
    script: true,
  });
}

export function usersPage(info: SiteInfo): string {
  const main = `<section class="abertura curta">
<h1>Quem usa</h1>
<p>O caminho ao contrário: escolha uma tabela, uma fila, um serviço de fora ou uma regra pura e veja quem chega até ela.</p>
</section>
<div class="filtro">
<nav id="tipos" class="segmentos" aria-label="Tipo"></nav>
<div class="campo"><label for="qual">Qual</label><select id="qual"></select></div>
</div>
<div id="resultado" aria-live="polite"><p class="vazio">Carregando o mapa…</p></div>
<noscript><p>Esta página precisa de JavaScript. Os mesmos dados estão em <a href="fluxo.json">fluxo.json</a>.</p></noscript>`;
  return layout({
    info,
    page: "quem-usa",
    title: "Quem usa",
    description:
      "Para cada tabela, fila, serviço de fora ou regra do FinTrack, as telas e as funções que chegam até ela.",
    main,
    script: true,
  });
}
