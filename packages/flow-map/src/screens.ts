// O lado do navegador: cada page.tsx (inteira ou no @modal) e cada layout.tsx (a moldura de um
// grupo de telas, com o menu). Segue os componentes que a tela usa de verdade e anota o que ela
// carrega no servidor, as actions dos formulários, os componentes do navegador e os links.
import path from "node:path";
import ts from "typescript";
import type { Context } from "./context";
import {
  appRoute,
  collectFacts,
  emptyFacts,
  jsxAttributeText,
  stringOf,
  uniqSorted,
  accessChain,
} from "./facts";
import type { Screen, SessionCheck } from "./model";
import { routeParams } from "./routes";
import { strongerSession } from "./server";
import { moduleInfo, reachLocals } from "./symbols";

const AREAS: Record<string, string> = {
  "": "Início",
  lancamentos: "Lançamentos",
  orcamento: "Orçamento",
  carteiras: "Carteiras",
  ajustes: "Ajustes",
  ajuda: "Ajuda",
  convite: "Convite",
  dev: "Desenvolvimento",
};

/** O nome de cada moldura (layout.tsx), pelo grupo de telas que ela envolve. */
const LAYOUT_TITLES: Record<string, string> = {
  "": "Documento (tema e avisos)",
  "(app)": "Moldura do app (menu)",
  "(auth)": "Moldura da entrada",
};

const SESSION_FILE = "apps/web/src/lib/auth/session.ts";
const UI_PRIMITIVES = "apps/web/src/components/ui/";
const isGroup = (segment: string) => /^\(.+\)$/.test(segment) && !segment.startsWith("(.");

type Place = { route: string; kind: Screen["kind"]; group: string };

/** O endereço de um arquivo de app/: (grupo) some, @modal/(.)x intercepta /x. */
export function placeOf(appDir: string, file: string): Place {
  const segments = path.relative(appDir, path.dirname(file)).split(path.sep).filter(Boolean);
  const group = segments.find(isGroup) ?? "";
  const modal = segments.some((s) => s.startsWith("@"));
  const visible = segments
    .filter((s) => !isGroup(s) && !s.startsWith("@"))
    .map((s) => s.replace(/^\(\.\)/, ""))
    .filter(Boolean);
  const route = "/" + visible.join("/");
  let kind: Screen["kind"] = "page";
  if (path.basename(file) === "layout.tsx") kind = "layout";
  else if (modal) kind = "modal";
  else if (group === "(auth)") kind = "public";
  return { route, kind, group };
}

/** O primeiro texto de um atributo ou propriedade com este nome no arquivo. */
function firstText(sf: ts.SourceFile, name: string): string | null {
  let found: string | null = null;
  const visit = (n: ts.Node) => {
    if (found !== null) return;
    if (ts.isPropertyAssignment(n) && n.name.getText() === name) found = stringOf(n.initializer);
    else if (ts.isJsxAttribute(n) && n.name.getText() === name) found = jsxAttributeText(n);
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return found;
}

/** Os ?campos que a tela lê: (await searchParams).q, params.mes, e a quem ela os entrega inteiros. */
function searchParamsOf(sf: ts.SourceFile): { names: string[]; passedTo: string[] } {
  const names = new Set<string>();
  const passedTo = new Set<string>();
  const holders = new Set<string>();
  const isAwaitedSearch = (e: ts.Node): boolean => {
    let x = e;
    while (ts.isParenthesizedExpression(x)) x = x.expression;
    return (
      ts.isAwaitExpression(x) &&
      ts.isIdentifier(x.expression) &&
      x.expression.text === "searchParams"
    );
  };
  const isSearch = (e: ts.Node) =>
    isAwaitedSearch(e) || (ts.isIdentifier(e) && holders.has(e.text));
  const visit = (n: ts.Node) => {
    if (ts.isVariableDeclaration(n) && n.initializer && isAwaitedSearch(n.initializer)) {
      if (ts.isIdentifier(n.name)) holders.add(n.name.text);
      else if (ts.isObjectBindingPattern(n.name)) {
        for (const el of n.name.elements) names.add((el.propertyName ?? el.name).getText());
      }
    }
    if (ts.isPropertyAccessExpression(n) && isSearch(n.expression)) names.add(n.name.text);
    if (ts.isCallExpression(n) && n.arguments.some(isSearch)) {
      const callee = accessChain(n.expression);
      if (callee) passedTo.add(callee.join("."));
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return { names: [...names].sort(), passedTo: [...passedTo].sort() };
}

type Unit = { file: string; names: string[] };

/** Uma tela: o que ela alcança do lado do app, parando nas actions e no código do servidor. */
export function analyzeScreen(ctx: Context, appDir: string, file: string): Screen {
  const { route, kind, group } = placeOf(appDir, file);
  const sf = ctx.source.parse(file);
  const facts = emptyFacts();
  const loaders = new Set<string>();
  const actions = new Set<string>();
  const clients = new Set<string>();
  const pageImports = new Map<string, string>(); // nome usado na própria página → id do carregamento
  let session: SessionCheck = "none";
  const defaultExport = moduleInfo(ctx.source, file).exports.get("default");
  const start = defaultExport && "local" in defaultExport ? defaultExport.local : "default";
  const seen = new Set<string>();
  const queue: Unit[] = [{ file, names: [start] }];
  while (queue.length > 0) {
    const unit = queue.pop() as Unit;
    const key = `${unit.file}#${unit.names.join(",")}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const reach = reachLocals(ctx.source, unit.file, unit.names);
    collectFacts(reach.nodes, facts, ctx.resolverFor(unit.file));
    for (const binding of reach.imports) {
      const def = ctx.definitionOf(unit.file, binding.spec, binding.imported);
      if (!def || !ctx.isWeb(def.file)) continue;
      const rel = ctx.rel(def.file);
      const directive = ctx.source.directive(def.file);
      if (directive === "use server") {
        actions.add(ctx.idOf(def.file, def.local));
      } else if (rel === SESSION_FILE) {
        session = strongerSession(session, def.local);
      } else if (ctx.isServerModule(def.file)) {
        if (!ctx.isFunction(def.file, def.local)) continue;
        const id = ctx.idOf(def.file, def.local);
        loaders.add(id);
        if (unit.file === file) {
          for (const [localName, b] of moduleInfo(ctx.source, file).imports) {
            if (b === binding) pageImports.set(localName, id);
          }
        }
      } else if (!rel.startsWith(UI_PRIMITIVES)) {
        if (directive === "use client") clients.add(rel);
        queue.push({ file: def.file, names: [def.local] });
      }
    }
  }
  const search = searchParamsOf(sf);
  const segment = route.split("/")[1] ?? "";
  let area = AREAS[segment] ?? segment;
  if (group === "(auth)") area = "Entrada";
  if (kind === "layout") area = "Moldura";
  const fallbackTitle = kind === "layout" ? (LAYOUT_TITLES[group] ?? `Moldura ${group}`) : route;
  return {
    route,
    file: ctx.rel(file),
    kind,
    title: kind === "layout" ? fallbackTitle : (firstText(sf, "title") ?? fallbackTitle),
    area,
    help: firstText(sf, "help"),
    params: routeParams(route),
    searchParams: search.names,
    searchParamsTo: uniqSorted(
      search.passedTo
        .map((name) => pageImports.get(name))
        .filter((id): id is string => Boolean(id)),
    ),
    session,
    loaders: [...loaders].sort(),
    actions: [...actions].sort(),
    clientComponents: [...clients].sort(),
    authCalls: uniqSorted(facts.authCalls),
    links: uniqSorted([...facts.links, ...facts.redirects].map((l) => appRoute(l) ?? l)),
  };
}
