// O mapa do fluxo do FinTrack, tirado do código: cada tela, o que ela carrega no servidor, o que os
// formulários dela chamam, o que cada chamada pede, toca no banco, põe na fila e alcança lá fora.
// Só lê o código (nada roda): o mesmo commit dá sempre o mesmo mapa.
import path from "node:path";
import { Context } from "./context";
import { collectFacts, emptyFacts, uniqSorted, walkFiles } from "./facts";
import type { Api, FlowMap, Queue, Screen } from "./model";
import { analyzeScreen } from "./screens";
import { ServerAnalyzer } from "./server";
import { SERVICES } from "./services";
import { moduleInfo } from "./symbols";

const HTTP_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]);
const KIND_ORDER: Record<Screen["kind"], number> = { layout: 0, page: 1, public: 2, modal: 3 };

export function analyze(root: string): FlowMap {
  const ctx = new Context(root);
  const server = new ServerAnalyzer(ctx);
  const appDir = path.join(ctx.webSrc, "app");

  // As telas e as molduras
  const screens = walkFiles(appDir, (n) => n === "page.tsx" || n === "layout.tsx")
    .map((file) => analyzeScreen(ctx, appDir, file))
    .sort((a, b) => a.route.localeCompare(b.route) || KIND_ORDER[a.kind] - KIND_ORDER[b.kind]);

  const byId = (ids: Iterable<string>) =>
    uniqSorted(ids).map((id) => {
      const [rel, name] = id.split("#") as [string, string];
      return server.function(path.join(root, rel), name);
    });
  const loaders = byId(screens.flatMap((s) => s.loaders));
  const actions = byId(screens.flatMap((s) => s.actions));

  // As rotas de API
  const apis: Api[] = [];
  for (const file of walkFiles(appDir, (n) => n === "route.ts")) {
    const methods = [...moduleInfo(ctx.source, file).exports.keys()]
      .filter((name) => HTTP_METHODS.has(name))
      .sort();
    if (methods.length === 0) continue;
    const route = "/" + ctx.rel(path.dirname(file)).replace(/^apps\/web\/src\/app\/?/, "");
    const name = methods.join(", ");
    const fn = server.named(
      ctx.idOf(file, methods.join(",")),
      file,
      name,
      server.facts({ file, names: methods }),
    );
    apis.push({ ...fn, route, methods });
  }
  apis.sort((a, b) => a.route.localeCompare(b.route));

  // As filas: quem põe trabalho, o horário fixo e o trabalhador
  const queues = new Map<string, Queue>();
  const queueOf = (name: string): Queue => {
    let q = queues.get(name);
    if (!q) {
      q = { name, enqueuedBy: [], schedule: null, worker: null };
      queues.set(name, q);
    }
    return q;
  };
  for (const fn of [...loaders, ...actions, ...apis]) {
    for (const name of fn.enqueues) queueOf(name).enqueuedBy.push(fn.id);
  }
  for (const file of walkFiles(ctx.webSrc, (n) => /\.tsx?$/.test(n) && !/\.test\.tsx?$/.test(n))) {
    const facts = emptyFacts();
    collectFacts([ctx.source.parse(file)], facts, ctx.resolverFor(file));
    for (const ref of facts.queueRefs) {
      const name = ctx.constValue(file, ref.queue);
      if (!name) continue;
      if (ref.kind === "schedule") {
        const cron = ref.call.arguments[1];
        queueOf(name).schedule = cron ? ctx.constValue(file, cron) : null;
      }
      const handler = ref.call.arguments[ref.call.arguments.length - 1];
      if (ref.kind === "work" && handler) {
        const id = `${ctx.rel(file)}#work(${name})`;
        const worker = server.named(
          id,
          file,
          `trabalhador de ${name}`,
          server.facts({ file, names: [], nodes: [handler] }),
        );
        queueOf(name).worker = worker;
        for (const next of worker.enqueues) if (next !== name) queueOf(next).enqueuedBy.push(id);
      }
    }
  }
  for (const q of queues.values()) q.enqueuedBy = uniqSorted(q.enqueuedBy);

  return {
    version: 1,
    screens,
    loaders,
    actions,
    apis,
    queues: [...queues.values()].sort((a, b) => a.name.localeCompare(b.name)),
    db: server.dbFunctions(),
    tables: ctx.models.map(({ model, table }) => ({ model, table })),
    services: SERVICES,
  };
}
