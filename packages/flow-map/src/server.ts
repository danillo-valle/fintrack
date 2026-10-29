// O lado do servidor: o que uma Server Action, um carregamento de tela, uma rota de API ou o
// trabalhador de uma fila alcança. Desce pelo app e pelos importadores; no packages/db anota a
// função chamada (e as tabelas dela) e no packages/core a regra pura usada.
import ts from "typescript";
import type { Context } from "./context";
import { collectFacts, emptyFacts, tablesFrom, uniqSorted, type QueueRef } from "./facts";
import type { DbFunction, ServerFunction, SessionCheck } from "./model";
import { reachLocals, referencedNames } from "./symbols";

/**
 * Onde o mapa para de descer: a configuração (env) e o log, que toda função usa e nada dizem do
 * fluxo, e o Better Auth, que só é seguido a partir da própria rota /api/auth (as outras funções
 * só pedem a sessão a ele; segui-lo daria a todas o e-mail e as senhas vazadas).
 */
const STOP_FILES = new Set(["apps/web/src/lib/env.ts", "apps/web/src/lib/logger.ts"]);
const AUTH_FILE = "apps/web/src/lib/auth.ts";
/** A sessão: requireUser e requireRecentAuth viram o "pede" da função, sem os redirects de dentro. */
const SESSION_FILE = "apps/web/src/lib/auth/session.ts";
const AUTH_ROUTE = "apps/web/src/app/api/auth/[...all]/route.ts";

/** A checagem de sessão mais forte entre a que já se viu e a chamada agora. */
export function strongerSession(current: SessionCheck, called: string): SessionCheck {
  if (called === "requireRecentAuth") return "recent";
  if (called === "requireUser" && current === "none") return "user";
  return current;
}

type Unit = { file: string; names: string[]; nodes?: ts.Node[] };

export type ServerFacts = Omit<ServerFunction, "id" | "file" | "name"> & {
  queueRefs: { file: string; ref: QueueRef }[];
};

export class ServerAnalyzer {
  private readonly db = new Map<string, DbFunction>();
  private readonly functions = new Map<string, ServerFunction>();

  constructor(private readonly ctx: Context) {}

  dbFunctions(): DbFunction[] {
    return [...this.db.values()].sort((a, b) => a.id.localeCompare(b.id));
  }

  /** Uma função do packages/db: as tabelas e os serviços que ela alcança, por dentro do pacote. */
  dbFunction(file: string, name: string): DbFunction {
    const { ctx } = this;
    const id = ctx.idOf(file, name);
    const cached = this.db.get(id);
    if (cached) return cached;
    const facts = emptyFacts();
    const services = new Set<string>();
    const seen = new Set<string>();
    const queue: Unit[] = [{ file, names: [name] }];
    while (queue.length > 0) {
      const unit = queue.pop() as Unit;
      const key = `${unit.file}#${unit.names.join(",")}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const reach = reachLocals(ctx.source, unit.file, unit.names);
      collectFacts(reach.nodes, facts, ctx.resolverFor(unit.file));
      const service = ctx.serviceOf(unit.file, reach.nodes);
      if (service) services.add(service);
      for (const binding of reach.imports) {
        const def = ctx.definitionOf(unit.file, binding.spec, binding.imported);
        if (
          def &&
          (ctx.inDir(def.file, "packages/db/src") || ctx.inDir(def.file, "packages/importers/src"))
        ) {
          queue.push({ file: def.file, names: [def.local] });
        }
      }
    }
    const fn: DbFunction = {
      id,
      file: ctx.rel(file),
      name,
      tables: tablesFrom(facts, ctx.models),
      services: uniqSorted(services),
    };
    this.db.set(id, fn);
    return fn;
  }

  /** Tudo o que uma função do servidor alcança, a partir de nomes (ou de nós, para uma função anônima). */
  facts(start: Unit): ServerFacts {
    const { ctx } = this;
    const facts = emptyFacts();
    const db = new Set<string>();
    const rules = new Set<string>();
    const services = new Set<string>();
    const input = new Set<string>();
    const queueRefs: ServerFacts["queueRefs"] = [];
    const seen = new Set<string>();
    const queue: Unit[] = [start];
    const followAuth = ctx.rel(start.file) === AUTH_ROUTE;
    let session: SessionCheck = "none";
    while (queue.length > 0) {
      const unit = queue.pop() as Unit;
      const key = `${unit.file}#${unit.names.join(",")}#${unit.nodes ? "nós" : ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const startNames = new Set(unit.names);
      for (const node of unit.nodes ?? [])
        for (const ref of referencedNames(node)) startNames.add(ref);
      const reach = reachLocals(ctx.source, unit.file, startNames);
      const nodes = [...(unit.nodes ?? []), ...reach.nodes];
      const local = emptyFacts();
      collectFacts(nodes, local, ctx.resolverFor(unit.file));
      for (const r of local.redirects) facts.redirects.add(r);
      for (const a of local.accessors) facts.accessors.add(a);
      facts.rawSql.push(...local.rawSql);
      for (const p of local.permissions) facts.permissions.add(p);
      facts.financeChanged ||= local.financeChanged;
      for (const ref of local.queueRefs) queueRefs.push({ file: unit.file, ref });
      // O que chega: só o que a própria função confere (o schema dela e os campos do formulário)
      if (unit === start) {
        for (const schema of local.schemas) {
          for (const field of ctx.schemaFields(unit.file, schema)) input.add(field);
        }
        for (const field of local.formFields) input.add(field);
      }
      const service = ctx.serviceOf(unit.file, nodes);
      if (service) services.add(service);
      for (const binding of reach.imports) {
        const def = ctx.definitionOf(unit.file, binding.spec, binding.imported);
        if (!def) continue;
        const rel = ctx.rel(def.file);
        if (ctx.inDir(def.file, "packages/db/src")) {
          if (!ctx.isFunction(def.file, def.local)) continue;
          const fn = this.dbFunction(def.file, def.local);
          db.add(fn.id);
          for (const s of fn.services) services.add(s);
        } else if (ctx.inDir(def.file, "packages/core/src")) {
          if (ctx.isFunction(def.file, def.local)) rules.add(ctx.idOf(def.file, def.local));
        } else if (rel === SESSION_FILE) {
          session = strongerSession(session, def.local);
        } else if (STOP_FILES.has(rel) || (rel === AUTH_FILE && !followAuth)) {
          continue;
        } else if (ctx.isWeb(def.file) || ctx.inDir(def.file, "packages/importers/src")) {
          queue.push({ file: def.file, names: [def.local] });
        }
      }
    }
    const enqueues = queueRefs
      .filter(({ ref }) => ref.kind === "send")
      .map(({ file, ref }) => ctx.constValue(file, ref.queue))
      .filter((name): name is string => name !== null);
    return {
      input: [...input].sort(),
      permissions: uniqSorted(facts.permissions),
      db: uniqSorted(db),
      tables: tablesFrom(facts, ctx.models),
      enqueues: uniqSorted(enqueues),
      services: uniqSorted(services),
      rules: uniqSorted(rules),
      redirects: uniqSorted(facts.redirects),
      financeChanged: facts.financeChanged,
      session,
      queueRefs,
    };
  }

  /** Uma função do servidor com nome (action ou carregamento), uma vez só. */
  function(file: string, name: string): ServerFunction {
    const id = this.ctx.idOf(file, name);
    const cached = this.functions.get(id);
    if (cached) return cached;
    const fn = this.named(id, file, name, this.facts({ file, names: [name] }));
    this.functions.set(id, fn);
    return fn;
  }

  named(id: string, file: string, name: string, facts: ServerFacts): ServerFunction {
    const { queueRefs: _refs, ...rest } = facts;
    void _refs;
    return { id, file: this.ctx.rel(file), name, ...rest };
  }
}
