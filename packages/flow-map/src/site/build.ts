// pnpm --filter @fintrack/flow-map site: monta o site "FinTrack por dentro" em packages/flow-map/dist/site
// (o mesmo que o CI publica no GitHub Pages). Lê o fluxo.json que está no Git (o teste garante que
// ele está em dia), desenha o C4 do c4.md e empacota o JavaScript do navegador.
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { build } from "esbuild";
import type { FlowMap } from "../model";
import { renderDiagrams, sizeOf } from "./diagrams";
import type { SiteInfo } from "./html";
import { c4Sections } from "./markdown";
import { flowPage, overviewPage, usersPage } from "./pages";
import { OUT_DIR, PACKAGE_DIR } from "./paths";

const PACKAGE = PACKAGE_DIR;
const ROOT = path.resolve(PACKAGE, "../..");
const OUT = OUT_DIR;

function siteInfo(): SiteInfo {
  const repo = process.env.GITHUB_REPOSITORY ?? "danillo-valle/fintrack";
  const commit =
    process.env.GITHUB_SHA ??
    execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim();
  return { repo, commit };
}

/** A média do relatório, lida da própria tabela de notas (o site não repete o número à mão). */
function reportAverage(): string {
  const text = readFileSync(path.join(ROOT, "docs/arquitetura/relatorio.md"), "utf8");
  return /\*\*Média\*\*\s*\|\s*\*\*([\d,]+)\*\*/.exec(text)?.[1] ?? "no relatório";
}

async function main() {
  const info = siteInfo();
  const map = JSON.parse(
    readFileSync(path.join(ROOT, "docs/arquitetura/fluxo.json"), "utf8"),
  ) as FlowMap;
  const sections = c4Sections(readFileSync(path.join(ROOT, "docs/arquitetura/c4.md"), "utf8"));
  if (sections.length !== 3)
    throw new Error(`o c4.md devia ter 3 diagramas, tem ${sections.length}`);
  const adrs = readdirSync(path.join(ROOT, "docs/adr")).filter((f) =>
    /^\d{4}-.*\.md$/.test(f),
  ).length;

  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(path.join(OUT, "fontes"), { recursive: true });

  const svgs = await renderDiagrams(sections);
  for (const [id, svg] of svgs) writeFileSync(path.join(OUT, `${id}.svg`), svg);

  const sizes = new Map([...svgs].map(([id, svg]) => [id, sizeOf(svg)]));
  writeFileSync(
    path.join(OUT, "index.html"),
    overviewPage(info, { map, sections, sizes, adrs, reportAverage: reportAverage() }),
  );
  writeFileSync(path.join(OUT, "fluxo.html"), flowPage(info));
  writeFileSync(path.join(OUT, "quem-usa.html"), usersPage(info));
  writeFileSync(path.join(OUT, "fluxo.json"), JSON.stringify(map));
  cpSync(path.join(import.meta.dirname, "site.css"), path.join(OUT, "site.css"));
  cpSync(path.join(import.meta.dirname, "favicon.svg"), path.join(OUT, "favicon.svg"));

  // As fontes do app (Geist), servidas pelo próprio site, com a licença junto
  // (o pacote não exporta o package.json; a pasta dele no node_modules do flow-map basta)
  const geist = path.join(PACKAGE, "node_modules/geist");
  cpSync(
    path.join(geist, "dist/fonts/geist-sans/Geist-Variable.woff2"),
    path.join(OUT, "fontes/Geist-Variable.woff2"),
  );
  cpSync(
    path.join(geist, "dist/fonts/geist-mono/GeistMono-Variable.woff2"),
    path.join(OUT, "fontes/GeistMono-Variable.woff2"),
  );
  cpSync(path.join(geist, "LICENSE.txt"), path.join(OUT, "fontes/LICENSE.txt"));

  await build({
    entryPoints: [path.join(import.meta.dirname, "client/main.ts")],
    bundle: true,
    format: "esm",
    target: "es2022",
    minify: true,
    sourcemap: false,
    outfile: path.join(OUT, "app.js"),
    logLevel: "warning",
  });
  console.warn(`site: ${OUT} (commit ${info.commit.slice(0, 7)})`);
}

await main();
