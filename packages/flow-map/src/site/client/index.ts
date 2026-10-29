// Os índices do mapa que o site usa nos dois sentidos: da tela até o banco (o mapa do fluxo) e do
// banco até as telas (quem usa). Puro: recebe o fluxo.json, não toca no DOM (testado no Vitest).
import type { DbFunction, FlowMap, Queue, Screen, ServerFunction } from "../../model";
import { routeMatches } from "../../routes";

export type FnKind = "loader" | "action" | "api" | "worker";
export type IndexedFn = ServerFunction & { kind: FnKind };

/** A chave de uma tela no endereço: a rota, com "~modal" no modal e "moldura-(grupo)" na moldura. */
export function screenKey(screen: Screen): string {
  if (screen.kind === "layout") {
    const group = /app\/(\([^)]+\))\//.exec(screen.file)?.[1] ?? "raiz";
    return `moldura-${group}`;
  }
  return screen.kind === "modal" ? `${screen.route}~modal` : screen.route;
}

export const shortName = (id: string) => id.slice(id.lastIndexOf("#") + 1);
export const fileOf = (id: string) => id.slice(0, id.lastIndexOf("#"));

export class MapIndex {
  readonly map: FlowMap;
  readonly screens: Screen[];
  readonly fns = new Map<string, IndexedFn>();
  readonly db = new Map<string, DbFunction>();
  /** id de uma função do servidor → as telas que a chamam */
  readonly screensOfFn = new Map<string, Screen[]>();
  /** id de uma função do banco → as funções do servidor que a chamam */
  readonly callersOfDb = new Map<string, string[]>();

  constructor(map: FlowMap) {
    this.map = map;
    this.screens = map.screens;
    const add = (fn: ServerFunction, kind: FnKind) => this.fns.set(fn.id, { ...fn, kind });
    for (const fn of map.loaders) add(fn, "loader");
    for (const fn of map.actions) add(fn, "action");
    for (const fn of map.apis) add(fn, "api");
    for (const q of map.queues) if (q.worker) add(q.worker, "worker");
    for (const d of map.db) this.db.set(d.id, d);
    for (const screen of map.screens) {
      for (const id of [...screen.loaders, ...screen.actions]) push(this.screensOfFn, id, screen);
    }
    for (const fn of this.fns.values()) for (const d of fn.db) push(this.callersOfDb, d, fn.id);
  }

  screenByKey(key: string): Screen | undefined {
    return this.screens.find((s) => screenKey(s) === key);
  }

  /** A tela de destino de um link (a página inteira, não o modal). */
  linkTarget(link: string): Screen | undefined {
    return this.screens.find(
      (s) => (s.kind === "page" || s.kind === "public") && routeMatches(s.route, link),
    );
  }

  /** As outras formas da mesma tela (a página e o modal da mesma rota). */
  variants(screen: Screen): Screen[] {
    return this.screens.filter(
      (s) => s.route === screen.route && s.kind !== "layout" && s !== screen,
    );
  }

  /** Tudo o que uma função do servidor alcança no banco: as funções e as tabelas (com as diretas). */
  reach(fnIds: Iterable<string>): { db: string[]; tables: string[]; services: string[] } {
    const db = new Set<string>();
    const tables = new Set<string>();
    const services = new Set<string>();
    for (const id of fnIds) {
      const fn = this.fns.get(id);
      if (!fn) continue;
      fn.tables.forEach((t) => tables.add(t));
      fn.services.forEach((s) => services.add(s));
      for (const d of fn.db) {
        db.add(d);
        this.db.get(d)?.tables.forEach((t) => tables.add(t));
        this.db.get(d)?.services.forEach((s) => services.add(s));
      }
    }
    return { db: [...db].sort(), tables: [...tables].sort(), services: [...services].sort() };
  }

  /** Quem usa uma tabela, uma fila, um serviço ou uma regra: as funções e, por elas, as telas. */
  usersOf(kind: UsageKind, name: string): Usage {
    const fnIds = new Set<string>();
    const dbIds = new Set<string>();
    const queues = new Set<string>();
    for (const fn of this.fns.values()) {
      const r = this.reach([fn.id]);
      const hit =
        (kind === "tabela" && r.tables.includes(name)) ||
        (kind === "servico" && r.services.includes(name)) ||
        (kind === "regra" && fn.rules.includes(name)) ||
        (kind === "fila" && fn.enqueues.includes(name));
      if (hit) fnIds.add(fn.id);
    }
    for (const d of this.db.values()) {
      if (
        (kind === "tabela" && d.tables.includes(name)) ||
        (kind === "servico" && d.services.includes(name))
      ) {
        dbIds.add(d.id);
      }
    }
    for (const q of this.map.queues) {
      if (kind === "fila" && q.name === name) queues.add(q.name);
      if (q.worker && fnIds.has(q.worker.id)) queues.add(q.name);
    }
    const screens = new Set<Screen>();
    for (const id of fnIds) for (const s of this.screensOfFn.get(id) ?? []) screens.add(s);
    return {
      screens: [...screens].sort(
        (a, b) => a.route.localeCompare(b.route) || a.kind.localeCompare(b.kind),
      ),
      fns: [...fnIds].sort().map((id) => this.fns.get(id) as IndexedFn),
      db: [...dbIds].sort().map((id) => this.db.get(id) as DbFunction),
      queues: [...queues].sort().map((n) => this.map.queues.find((q) => q.name === n) as Queue),
    };
  }

  /** As opções do "quem usa" para cada tipo, sem as que ninguém usa. */
  options(kind: UsageKind): { value: string; label: string }[] {
    if (kind === "tabela") {
      return this.map.tables
        .map((t) => ({ value: t.model, label: `${t.model} (${t.table})` }))
        .filter(
          (o) =>
            this.usersOf("tabela", o.value).fns.length + this.usersOf("tabela", o.value).db.length >
            0,
        );
    }
    if (kind === "fila") return this.map.queues.map((q) => ({ value: q.name, label: q.name }));
    if (kind === "servico") return this.map.services.map((s) => ({ value: s.id, label: s.name }));
    const rules = new Set<string>();
    for (const fn of this.fns.values()) fn.rules.forEach((r) => rules.add(r));
    return [...rules].sort().map((r) => ({
      value: r,
      label: `${shortName(r)} (${fileOf(r).replace("packages/core/src/", "")})`,
    }));
  }

  /** As telas que a busca acha: pelo título, pela rota ou por uma função ou tabela que elas usam. */
  search(query: string): Screen[] {
    const q = normalize(query.trim());
    if (!q) return this.screens;
    return this.screens.filter((s) => {
      if (normalize(`${s.title} ${s.route} ${s.area}`).includes(q)) return true;
      const ids = [...s.loaders, ...s.actions];
      if (ids.some((id) => normalize(shortName(id)).includes(q))) return true;
      const r = this.reach(ids);
      return [...r.tables, ...r.db.map(shortName)].some((n) => normalize(n).includes(q));
    });
  }
}

export type UsageKind = "tabela" | "fila" | "servico" | "regra";
export type Usage = { screens: Screen[]; fns: IndexedFn[]; db: DbFunction[]; queues: Queue[] };

export function normalize(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

function push<K, V>(map: Map<K, V[]>, key: K, value: V) {
  const list = map.get(key);
  if (list) {
    if (!list.includes(value)) list.push(value);
  } else map.set(key, [value]);
}
