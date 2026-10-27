// axe em todas as telas (M12.2, ADR-021): toda rota de src/app passa por uma conferência do axe.
// Ou ela está em PAGES/PUBLIC_PAGES (axe nos temas claro e escuro, foco e CSP, de graça), ou só
// existe no meio de um fluxo (precisa de um código, de um arquivo, de um par) e o teste desse
// fluxo roda o axe com ela à vista: aí ela entra em FLOW_AXE, com o arquivo e um trecho que prova.
//
// Tela nova sem nenhum dos dois faz este teste falhar, com o nome da rota. Ele não abre navegador:
// lê as pastas do app e os arquivos de teste.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { PAGES, PUBLIC_PAGES } from "./helpers";

const APP_DIR = path.resolve(process.cwd(), "src/app");
const E2E_DIR = path.resolve(process.cwd(), "e2e");

/** Telas que só existem no meio de um fluxo: o teste que roda o axe nelas e o trecho que o mostra. */
const FLOW_AXE: Record<string, { spec: string; marker: string }> = {
  "/ajustes/bot/vincular": { spec: "bot-whatsapp.spec.ts", marker: "// o modal com o código" },
  "/ajustes/conexoes/credenciais": {
    spec: "coleta-bancaria.spec.ts",
    marker: "conexoes/credenciais",
  },
  "/ajustes/conexoes/ligar": { spec: "coleta-bancaria.spec.ts", marker: "conexoes/ligar" },
  "/ajustes/conexoes/sincronizacoes": { spec: "coleta-bancaria.spec.ts", marker: "sincronizacoes" },
  "/lancamentos/exportar": { spec: "lancamentos.spec.ts", marker: "exportar" },
  "/lancamentos/importar/[importId]": {
    spec: "importar-extrato.spec.ts",
    marker: "/lancamentos/importar",
  },
  "/lancamentos/recebidos/criar/[receivedId]": {
    spec: "ia-local.spec.ts",
    marker: "recebidos/criar",
  },
  "/lancamentos/recebidos/par/[receivedId]": { spec: "revisao.spec.ts", marker: "recebidos/par" },
  "/configurar-2fa": { spec: "acessibilidade.spec.ts", marker: "/configurar-2fa" },
  "/entrar/dois-fatores": { spec: "acessibilidade.spec.ts", marker: "/entrar/dois-fatores" },
  "/reautenticar": { spec: "acessibilidade.spec.ts", marker: "/reautenticar" },
};

/** As rotas do app: cada page.tsx, sem os grupos "(app)" e sem as cópias de modal (@modal). */
function appRoutes(): string[] {
  const routes = new Set<string>();
  for (const entry of readdirSync(APP_DIR, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile() || entry.name !== "page.tsx") continue;
    const relative = path.relative(APP_DIR, entry.parentPath).split(path.sep);
    if (relative.some((part) => part.startsWith("@"))) continue;
    const segments = relative.filter((part) => part && !/^\(.*\)$/.test(part));
    routes.add(`/${segments.join("/")}`);
  }
  return [...routes].sort();
}

/** A rota casa com um caminho de PAGES? ([id] vale qualquer segmento; "?..." fica de fora). */
function matches(route: string, page: string): boolean {
  const pattern = route.replace(/\[[^\]]+\]/g, "[^/]+");
  return new RegExp(`^${pattern}$`).test(page.split("?")[0] ?? page);
}

test("toda tela do app passa pelo axe", async () => {
  test.skip(test.info().project.name !== "desktop", "lê arquivos: um aparelho basta");
  // O catálogo /dev/ui só existe no dev e só entra em PAGES lá: conta como coberto nos dois modos
  const listed = [...PAGES, ...PUBLIC_PAGES, "/dev/ui"];
  const missing = appRoutes().filter(
    (route) => !listed.some((page) => matches(route, page)) && !(route in FLOW_AXE),
  );
  expect(
    missing,
    "tela sem axe: ponha em PAGES ou rode o axe no teste do fluxo e registre em FLOW_AXE",
  ).toEqual([]);
});

test("cada tela de FLOW_AXE é conferida pelo axe no teste indicado", async () => {
  test.skip(test.info().project.name !== "desktop", "lê arquivos: um aparelho basta");
  const routes = appRoutes();
  const problems: string[] = [];
  for (const [route, { spec, marker }] of Object.entries(FLOW_AXE)) {
    if (!routes.includes(route)) problems.push(`${route}: a rota não existe mais`);
    const text = readFileSync(path.join(E2E_DIR, spec), "utf8");
    if (!/expectNoA11yViolations\(|checkAxe\(/.test(text)) problems.push(`${spec}: não roda o axe`);
    if (!text.includes(marker)) problems.push(`${spec}: não achei "${marker}" (${route})`);
  }
  expect(problems).toEqual([]);
});
