// Os fatos que o mapa tira de um pedaço de código: para onde ele leva, o que chama do Better Auth,
// que tabelas usa, que filas toca, que schema confere, que permissão pede. Só sintaxe: nada roda.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";

export const uniqSorted = (items: Iterable<string>) => [...new Set(items)].sort();

export function walkFiles(dir: string, accept: (name: string) => boolean): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "node_modules" && entry.name !== "generated") {
        out.push(...walkFiles(full, accept));
      }
    } else if (accept(entry.name)) out.push(full);
  }
  return out.sort();
}

export type Model = { model: string; table: string; accessor: string };

/** Os modelos do Prisma, com a tabela (@@map) e o nome no cliente (prisma.financialAccount). */
export function prismaModels(root: string): Model[] {
  const dir = path.join(root, "packages/db/prisma/schema");
  const models: Model[] = [];
  for (const file of walkFiles(dir, (n) => n.endsWith(".prisma"))) {
    const text = readFileSync(file, "utf8");
    for (const match of text.matchAll(/^model (\w+) \{([\s\S]*?)^\}/gm)) {
      const name = match[1] as string;
      const table = /@@map\("([^"]+)"\)/.exec(match[2] ?? "")?.[1] ?? name;
      models.push({ model: name, table, accessor: name.charAt(0).toLowerCase() + name.slice(1) });
    }
  }
  return models.sort((a, b) => a.model.localeCompare(b.model));
}

/** O valor de texto de uma constante do código (PAGE = "/ajustes/contas"), quando dá para saber. */
export type Resolve = (expr: ts.Expression) => string | null;

/**
 * O texto de um literal. Num template, o que é constante entra com o valor e o resto vira "[…]":
 * `${PAGE}/${id}` → "/ajustes/contas/[…]" (o site acha a tela de destino por esse molde).
 */
export function stringOf(node: ts.Node | undefined, resolve?: Resolve): string | null {
  if (!node) return null;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isTemplateExpression(node)) {
    let text = node.head.text;
    for (const span of node.templateSpans) {
      text += `${resolve?.(span.expression) ?? "[…]"}${span.literal.text}`;
    }
    return text;
  }
  if (resolve && (ts.isIdentifier(node) || ts.isPropertyAccessExpression(node)))
    return resolve(node);
  return null;
}

/**
 * Só endereços do próprio app (começam com "/"), sem o #âncora e sem o ?filtro. Um pedaço
 * variável grudado no texto ("/orcamento" seguido de ${query}) é o filtro montado à parte: sai
 * também.
 */
export function appRoute(text: string | null): string | null {
  if (!text || !text.startsWith("/") || text.startsWith("//")) return null;
  let clean = text.split(/[?#]/)[0] ?? "";
  const glued = /[^/]\[…\]/.exec(clean);
  if (glued) clean = clean.slice(0, glued.index + 1);
  clean = clean.replace(/\/$/, "");
  return clean === "" ? "/" : clean;
}

/** a.b.c → ["a", "b", "c"] (só nomes; null se tiver uma chamada ou um índice no meio) */
export function accessChain(node: ts.Expression): string[] | null {
  if (ts.isIdentifier(node)) return [node.text];
  if (ts.isPropertyAccessExpression(node)) {
    const base = accessChain(node.expression);
    return base ? [...base, node.name.text] : null;
  }
  return null;
}

/** O texto de um atributo JSX: href="/x" ou href={"/x"} ou href={`/x/${id}`}. */
export function jsxAttributeText(attr: ts.JsxAttribute, resolve?: Resolve): string | null {
  const init = attr.initializer;
  if (!init) return null;
  return ts.isJsxExpression(init) ? stringOf(init.expression, resolve) : stringOf(init, resolve);
}

/** Os nomes que o código usa para o cliente do Prisma. */
const PRISMA_CLIENTS = new Set(["prisma", "db", "tx"]);
const LINK_ATTRIBUTES = new Set(["href", "backHref"]);
const ACCESS_CHECKS = new Set(["requireWalletAccess", "requireHouseholdAccess"]);

export type QueueRef = {
  kind: "send" | "work" | "schedule";
  queue: ts.Expression;
  call: ts.CallExpression;
};

export type Facts = {
  links: Set<string>;
  redirects: Set<string>;
  authCalls: Set<string>;
  /** prisma.<isto>.findMany: os modelos usados direto */
  accessors: Set<string>;
  /** o texto dos templates marcados ($queryRaw`...`), para achar as tabelas do SQL */
  rawSql: string[];
  queueRefs: QueueRef[];
  /** os nomes conferidos com .parse/.safeParse (os schemas zod) */
  schemas: Set<string>;
  /** formData.get("campo") */
  formFields: Set<string>;
  permissions: Set<string>;
  financeChanged: boolean;
};

export function emptyFacts(): Facts {
  return {
    links: new Set(),
    redirects: new Set(),
    authCalls: new Set(),
    accessors: new Set(),
    rawSql: [],
    queueRefs: [],
    schemas: new Set(),
    formFields: new Set(),
    permissions: new Set(),
    financeChanged: false,
  };
}

function callFacts(call: ts.CallExpression, into: Facts, resolve?: Resolve) {
  const chain = accessChain(call.expression);
  if (!chain) return;
  const [first, second] = chain;
  const last = chain[chain.length - 1];
  const arg = call.arguments[0];
  if (chain.length === 1 && (first === "redirect" || first === "permanentRedirect")) {
    const route = appRoute(stringOf(arg, resolve));
    if (route) into.redirects.add(route);
  }
  if (chain.length === 2 && first === "router" && (second === "push" || second === "replace")) {
    const route = appRoute(stringOf(arg, resolve));
    if (route) into.links.add(route);
  }
  if (first === "authClient" && chain.length >= 2) into.authCalls.add(chain.slice(1).join("."));
  if (chain.length === 2 && first === "boss" && arg) {
    if (second === "send" || second === "work" || second === "schedule") {
      into.queueRefs.push({ kind: second, queue: arg, call });
    }
  }
  if (chain.length === 2 && first && (last === "safeParse" || last === "parse")) {
    into.schemas.add(first);
  }
  if (chain.length === 2 && first === "formData" && (second === "get" || second === "getAll")) {
    const field = stringOf(arg);
    if (field) into.formFields.add(field);
  }
  if (chain.length === 1 && first && ACCESS_CHECKS.has(first)) {
    for (const a of call.arguments) {
      const text = stringOf(a);
      if (text) into.permissions.add(text);
    }
  }
  if (chain.length === 1 && first === "financeChanged") into.financeChanged = true;
}

export function collectFacts(nodes: Iterable<ts.Node>, into: Facts, resolve?: Resolve) {
  const visit = (n: ts.Node) => {
    if (ts.isJsxAttribute(n) && LINK_ATTRIBUTES.has(n.name.getText())) {
      const route = appRoute(jsxAttributeText(n, resolve));
      if (route) into.links.add(route);
    } else if (ts.isPropertyAssignment(n) && ts.isIdentifier(n.name) && n.name.text === "href") {
      const route = appRoute(stringOf(n.initializer, resolve));
      if (route) into.links.add(route);
    } else if (ts.isCallExpression(n)) {
      callFacts(n, into, resolve);
    } else if (ts.isTaggedTemplateExpression(n)) {
      into.rawSql.push(n.template.getText());
    }
    // prisma.wallet.findMany(...), tx.transaction.create(...)
    if (
      ts.isPropertyAccessExpression(n) &&
      ts.isPropertyAccessExpression(n.expression) &&
      ts.isIdentifier(n.expression.expression) &&
      PRISMA_CLIENTS.has(n.expression.expression.text)
    ) {
      into.accessors.add(n.expression.name.text);
    }
    ts.forEachChild(n, visit);
  };
  for (const node of nodes) visit(node);
}

/** Os modelos que os fatos tocam: pelo cliente do Prisma ou pelo SQL escrito à mão. */
export function tablesFrom(facts: Facts, models: Model[]): string[] {
  const out = new Set<string>();
  const sql = facts.rawSql.join("\n");
  for (const model of models) {
    if (facts.accessors.has(model.accessor)) out.add(model.model);
    const inSql = new RegExp(`\\b(?:FROM|JOIN|UPDATE|INTO)\\s+"?${model.table}"?(?=[\\s;)"])`, "i");
    if (inSql.test(sql)) out.add(model.model);
  }
  return uniqSorted(out);
}
