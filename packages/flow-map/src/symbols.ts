// O que cada arquivo declara, importa e exporta, e o que cada declaração usa. Com isso o mapa
// segue só o que é usado de verdade: uma tela que importa um componente de um arquivo com três
// componentes só "chama" as actions do componente que usa, não as dos outros dois.
import ts from "typescript";
import type { Source } from "./source";

export type ImportBinding = { spec: string; imported: string };

export type ModuleInfo = {
  /** nome local → de onde vem (só imports de valor: "import type" não conta) */
  imports: Map<string, ImportBinding>;
  /** nome local → os nós que o declaram no topo do arquivo */
  decls: Map<string, ts.Node[]>;
  /** nome exportado → nome local, ou o import que ele repassa */
  exports: Map<string, { local: string } | { from: ImportBinding }>;
  /** export * from "..." */
  starExports: string[];
};

const infoCache = new WeakMap<ts.SourceFile, ModuleInfo>();

function hasModifier(node: ts.Node, kind: ts.SyntaxKind): boolean {
  return ts.canHaveModifiers(node) && (ts.getModifiers(node) ?? []).some((m) => m.kind === kind);
}

function addDecl(info: ModuleInfo, name: string, node: ts.Node) {
  const list = info.decls.get(name);
  if (list) list.push(node);
  else info.decls.set(name, [node]);
}

/** Os nomes que um padrão de desestruturação declara: const { a, b: [c] } = ... */
function bindingNames(name: ts.BindingName): string[] {
  if (ts.isIdentifier(name)) return [name.text];
  return name.elements.flatMap((el) => (ts.isOmittedExpression(el) ? [] : bindingNames(el.name)));
}

export function moduleInfo(source: Source, file: string): ModuleInfo {
  const sf = source.parse(file);
  const cached = infoCache.get(sf);
  if (cached) return cached;
  const info: ModuleInfo = {
    imports: new Map(),
    decls: new Map(),
    exports: new Map(),
    starExports: [],
  };
  for (const st of sf.statements) {
    if (ts.isImportDeclaration(st)) {
      const clause = st.importClause;
      if (!clause || clause.isTypeOnly || !ts.isStringLiteral(st.moduleSpecifier)) continue;
      const spec = st.moduleSpecifier.text;
      if (clause.name) info.imports.set(clause.name.text, { spec, imported: "default" });
      const bindings = clause.namedBindings;
      if (bindings && ts.isNamespaceImport(bindings)) {
        info.imports.set(bindings.name.text, { spec, imported: "*" });
      } else if (bindings) {
        for (const el of bindings.elements) {
          if (el.isTypeOnly) continue;
          info.imports.set(el.name.text, { spec, imported: (el.propertyName ?? el.name).text });
        }
      }
    } else if (ts.isExportDeclaration(st)) {
      if (st.isTypeOnly) continue;
      const spec =
        st.moduleSpecifier && ts.isStringLiteral(st.moduleSpecifier)
          ? st.moduleSpecifier.text
          : null;
      if (!st.exportClause) {
        if (spec) info.starExports.push(spec);
      } else if (ts.isNamedExports(st.exportClause)) {
        for (const el of st.exportClause.elements) {
          if (el.isTypeOnly) continue;
          const original = (el.propertyName ?? el.name).text;
          info.exports.set(
            el.name.text,
            spec ? { from: { spec, imported: original } } : { local: original },
          );
        }
      }
    } else if (ts.isExportAssignment(st)) {
      // export default <expressão>
      addDecl(info, "default", st.expression);
      info.exports.set("default", { local: "default" });
    } else if (
      ts.isFunctionDeclaration(st) ||
      ts.isClassDeclaration(st) ||
      ts.isEnumDeclaration(st)
    ) {
      const exported = hasModifier(st, ts.SyntaxKind.ExportKeyword);
      const isDefault = hasModifier(st, ts.SyntaxKind.DefaultKeyword);
      const name = st.name?.text ?? "default";
      addDecl(info, name, st);
      if (exported) info.exports.set(isDefault ? "default" : name, { local: name });
    } else if (ts.isVariableStatement(st)) {
      const exported = hasModifier(st, ts.SyntaxKind.ExportKeyword);
      for (const decl of st.declarationList.declarations) {
        for (const name of bindingNames(decl.name)) {
          addDecl(info, name, decl);
          if (exported) info.exports.set(name, { local: name });
        }
      }
    }
  }
  // Um nome exportado sem declaração no arquivo é um import repassado: export { a } (a importado)
  for (const [name, target] of info.exports) {
    if ("local" in target && !info.decls.has(target.local)) {
      const binding = info.imports.get(target.local);
      if (binding) info.exports.set(name, { from: binding });
    }
  }
  infoCache.set(sf, info);
  return info;
}

/**
 * Os nomes que aparecem dentro de um nó como referência (não o nome de uma propriedade, de um
 * atributo JSX ou de uma chave de objeto, que só coincidem no texto).
 */
export function referencedNames(node: ts.Node): Set<string> {
  const names = new Set<string>();
  const visit = (n: ts.Node) => {
    if (ts.isIdentifier(n)) {
      const parent = n.parent;
      const isPropertyName =
        (ts.isPropertyAccessExpression(parent) && parent.name === n) ||
        (ts.isPropertyAssignment(parent) && parent.name === n) ||
        (ts.isJsxAttribute(parent) && parent.name === n) ||
        (ts.isBindingElement(parent) && parent.propertyName === n) ||
        (ts.isMethodDeclaration(parent) && parent.name === n) ||
        (ts.isPropertyDeclaration(parent) && parent.name === n) ||
        (ts.isPropertySignature(parent) && parent.name === n);
      if (!isPropertyName) names.add(n.text);
    }
    // Tipos não chamam nada em tempo de execução
    if (ts.isTypeNode(n) || ts.isInterfaceDeclaration(n) || ts.isTypeAliasDeclaration(n)) return;
    ts.forEachChild(n, visit);
  };
  visit(node);
  return names;
}

export type Reach = {
  /** as declarações alcançadas (os nós), para tirar os fatos delas */
  nodes: ts.Node[];
  /** os imports usados por elas */
  imports: ImportBinding[];
};

/** A partir de alguns nomes locais, tudo o que eles usam no próprio arquivo, e os imports. */
export function reachLocals(source: Source, file: string, start: Iterable<string>): Reach {
  const info = moduleInfo(source, file);
  const seen = new Set<string>();
  const queue = [...start];
  const nodes: ts.Node[] = [];
  const imports = new Map<string, ImportBinding>();
  while (queue.length > 0) {
    const name = queue.pop() as string;
    if (seen.has(name)) continue;
    seen.add(name);
    const decls = info.decls.get(name);
    if (decls) {
      for (const node of decls) {
        nodes.push(node);
        for (const ref of referencedNames(node)) {
          if (ref !== name && !seen.has(ref)) queue.push(ref);
        }
      }
      continue;
    }
    const binding = info.imports.get(name);
    if (binding) imports.set(`${binding.spec}#${binding.imported}`, binding);
  }
  return { nodes, imports: [...imports.values()] };
}

/**
 * Onde um nome exportado é declarado de verdade, seguindo os repasses (export { a } from "./b",
 * export * from "./c"). Devolve null para o que vem de fora do repositório.
 */
export function definition(
  source: Source,
  file: string,
  name: string,
  depth = 0,
): { file: string; local: string } | null {
  if (depth > 20) return null;
  const info = moduleInfo(source, file);
  const target = info.exports.get(name);
  if (target && "local" in target) return { file, local: target.local };
  if (target && "from" in target) {
    const resolved = source.resolve(file, target.from.spec);
    return "file" in resolved
      ? definition(source, resolved.file, target.from.imported, depth + 1)
      : null;
  }
  for (const spec of info.starExports) {
    const resolved = source.resolve(file, spec);
    if (!("file" in resolved)) continue;
    const found = definition(source, resolved.file, name, depth + 1);
    if (found) return found;
  }
  return null;
}
