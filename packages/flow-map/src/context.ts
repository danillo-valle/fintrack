// O que todas as partes da análise compartilham: o código, os modelos do banco, os caminhos e as
// perguntas sobre um nome (é uma função? qual o valor desta constante? que campos tem este schema?).
import path from "node:path";
import ts from "typescript";
import { accessChain, prismaModels, stringOf, type Model } from "./facts";
import { SERVICES } from "./services";
import { Source } from "./source";
import { definition, moduleInfo } from "./symbols";

export class Context {
  readonly source: Source;
  readonly root: string;
  readonly models: Model[];
  private readonly serviceByFile = new Map<string, string>();

  constructor(root: string) {
    this.root = root;
    this.source = new Source(root);
    this.models = prismaModels(root);
    for (const service of SERVICES) {
      for (const file of service.files) this.serviceByFile.set(file, service.id);
    }
  }

  get webSrc(): string {
    return this.source.webSrc;
  }

  rel(file: string): string {
    return this.source.rel(file);
  }

  idOf(file: string, name: string): string {
    return `${this.rel(file)}#${name}`;
  }

  /** O arquivo está dentro da pasta (relativa à raiz)? */
  inDir(file: string, dir: string): boolean {
    return file.startsWith(path.join(this.root, dir) + path.sep);
  }

  isWeb(file: string): boolean {
    return this.inDir(file, "apps/web/src");
  }

  /** features/<nome>/server/: o código que só roda no servidor (consultas, actions, filas). */
  isServerModule(file: string): boolean {
    return /^apps\/web\/src\/features\/[^/]+\/server\//.test(this.rel(file));
  }

  /** Onde um import aponta de verdade, seguindo os repasses; null para pacote de fora. */
  definitionOf(
    from: string,
    spec: string,
    imported: string,
  ): { file: string; local: string } | null {
    const resolved = this.source.resolve(from, spec);
    return "file" in resolved ? definition(this.source, resolved.file, imported) : null;
  }

  declOf(file: string, name: string): ts.Node | undefined {
    return moduleInfo(this.source, file).decls.get(name)?.[0];
  }

  /** Uma função (declarada ou arrow), não uma constante, classe ou o cliente do banco. */
  isFunction(file: string, name: string): boolean {
    const decl = this.declOf(file, name);
    if (!decl) return false;
    if (ts.isFunctionDeclaration(decl)) return true;
    return (
      ts.isVariableDeclaration(decl) &&
      decl.initializer !== undefined &&
      (ts.isArrowFunction(decl.initializer) || ts.isFunctionExpression(decl.initializer))
    );
  }

  /** O serviço de fora que um pedaço alcançado representa: algo que roda, num arquivo de fronteira. */
  serviceOf(file: string, nodes: readonly ts.Node[]): string | null {
    const service = this.serviceByFile.get(this.rel(file));
    if (!service) return null;
    const runs = nodes.some(
      (n) =>
        ts.isFunctionDeclaration(n) ||
        ts.isClassDeclaration(n) ||
        (ts.isVariableDeclaration(n) &&
          n.initializer !== undefined &&
          (ts.isArrowFunction(n.initializer) || ts.isFunctionExpression(n.initializer))),
    );
    return runs ? service : null;
  }

  /** A declaração de variável por trás de um nome (local ou importado) e o arquivo dela. */
  private variable(file: string, name: string): { file: string; init: ts.Expression } | null {
    let declFile = file;
    let decl = this.declOf(file, name);
    if (!decl) {
      const binding = moduleInfo(this.source, file).imports.get(name);
      const def = binding ? this.definitionOf(file, binding.spec, binding.imported) : null;
      if (!def) return null;
      declFile = def.file;
      decl = this.declOf(def.file, def.local);
    }
    if (!decl || !ts.isVariableDeclaration(decl) || !decl.initializer) return null;
    return { file: declFile, init: unwrap(decl.initializer) };
  }

  /** Quem acha o valor das constantes de um arquivo (para os fatos tirados dele). */
  resolverFor(file: string): (expr: ts.Expression) => string | null {
    return (expr) => this.constValue(file, expr);
  }

  /** O texto de uma constante: "bank-sync", ou QUEUES.bankSync.name seguido até o literal. */
  constValue(file: string, expr: ts.Expression, depth = 0): string | null {
    if (depth > 10) return null;
    if (ts.isTemplateExpression(expr)) {
      return stringOf(expr, (e) => this.constValue(file, e, depth + 1));
    }
    const literal = stringOf(expr);
    if (literal !== null) return literal;
    const chain = accessChain(expr);
    if (!chain?.[0]) return null;
    const found = this.variable(file, chain[0]);
    if (!found) return null;
    let current: ts.Expression | undefined = found.init;
    for (const key of chain.slice(1)) {
      if (!current || !ts.isObjectLiteralExpression(current)) return null;
      const prop: ts.PropertyAssignment | undefined = current.properties.find(
        (p): p is ts.PropertyAssignment => ts.isPropertyAssignment(p) && p.name.getText() === key,
      );
      current = prop ? unwrap(prop.initializer) : undefined;
    }
    return current ? this.constValue(found.file, current, depth + 1) : null;
  }

  /** Os campos de um schema zod: as chaves de z.object({...}) e de .extend({...}), com as da base. */
  schemaFields(file: string, name: string, depth = 0): string[] {
    if (depth > 10) return [];
    const found = this.variable(file, name);
    if (!found) return [];
    const fields = new Set<string>();
    const visit = (n: ts.Node) => {
      if (ts.isCallExpression(n)) {
        const chain = accessChain(n.expression);
        const last = chain?.[chain.length - 1];
        const arg = n.arguments[0];
        if ((last === "object" || last === "extend") && arg && ts.isObjectLiteralExpression(arg)) {
          for (const prop of arg.properties) {
            if (prop.name) fields.add(prop.name.getText().replace(/^["']|["']$/g, ""));
          }
        }
        // baseSchema.extend(...), baseSchema.refine(...): os campos da base também
        if (
          ts.isPropertyAccessExpression(n.expression) &&
          ts.isIdentifier(n.expression.expression)
        ) {
          const base = n.expression.expression.text;
          if (base !== "z" && base !== name) {
            for (const f of this.schemaFields(found.file, base, depth + 1)) fields.add(f);
          }
        }
      }
      ts.forEachChild(n, visit);
    };
    visit(found.init);
    return [...fields].sort();
  }
}

function unwrap(expr: ts.Expression): ts.Expression {
  let e = expr;
  while (ts.isAsExpression(e) || ts.isSatisfiesExpression(e) || ts.isParenthesizedExpression(e)) {
    e = e.expression;
  }
  return e;
}
