// O mapa do FinTrack de verdade: em dia com o código, sem fronteira de rede esquecida, sem tela ou
// action de fora e sem link para uma tela que não existe. Documentação conferida não envelhece calada.
import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { analyze } from "./analyze";
import { walkFiles } from "./facts";
import type { FlowMap } from "./model";
import { serialize } from "./serialize";
import { routeMatches } from "./routes";
import { NETWORK_CALL, SERVICES } from "./services";

const ROOT = path.resolve(import.meta.dirname, "../../..");
const OUTPUT = path.join(ROOT, "docs/arquitetura/fluxo.json");
const rel = (file: string) => path.relative(ROOT, file).split(path.sep).join("/");

/** O código que vai para a produção: sem testes, sem os de mentira (testing/) e sem o e2e. */
function productionFiles(dir: string): string[] {
  return walkFiles(
    path.join(ROOT, dir),
    (n) => /\.tsx?$/.test(n) && !/\.test\.tsx?$/.test(n),
  ).filter((f) => !/[/\\](testing|e2e)[/\\]/.test(f));
}

let map: FlowMap;
beforeAll(() => {
  map = analyze(ROOT);
}, 60_000);

describe("docs/arquitetura/fluxo.json", () => {
  it("está em dia com o código (rode: pnpm --filter @fintrack/flow-map generate)", () => {
    expect(readFileSync(OUTPUT, "utf8")).toBe(serialize(map));
  });
});

describe("o mapa cobre o app inteiro", () => {
  it("toda page.tsx e layout.tsx do app é uma tela do mapa", () => {
    const files = walkFiles(
      path.join(ROOT, "apps/web/src/app"),
      (n) => n === "page.tsx" || n === "layout.tsx",
    );
    expect(map.screens.map((s) => s.file).sort()).toEqual(files.map(rel).sort());
  });

  it("toda Server Action exportada é chamada por alguma tela", () => {
    const exported: string[] = [];
    for (const file of productionFiles("apps/web/src")) {
      const text = readFileSync(file, "utf8");
      if (!text.startsWith('"use server"')) continue;
      for (const m of text.matchAll(/^export async function (\w+)/gm))
        exported.push(`${rel(file)}#${m[1]}`);
    }
    expect(exported.length).toBeGreaterThan(40);
    expect(map.actions.map((a) => a.id).sort()).toEqual(exported.sort());
  });

  it("todo link e todo redirect levam a uma tela que existe", () => {
    const routes = map.screens.filter((s) => s.kind !== "layout").map((s) => s.route);
    const exists = (link: string) => routes.some((route) => routeMatches(route, link));
    const broken = [
      ...map.screens.flatMap((s) =>
        s.links.filter((l) => !exists(l)).map((l) => `${s.file} → ${l}`),
      ),
      ...[...map.actions, ...map.loaders].flatMap((f) =>
        f.redirects.filter((l) => !exists(l)).map((l) => `${f.id} → ${l}`),
      ),
    ];
    expect(broken).toEqual([]);
  });
});

describe("a sessão (a regra do auth-guard, vista pelo mapa)", () => {
  it("toda tela de (app), inteira ou em modal, pede a sessão no servidor", () => {
    const open = map.screens
      .filter((s) => (s.kind === "page" || s.kind === "modal") && s.session === "none")
      .map((s) => s.file);
    expect(open).toEqual([]);
  });

  it("toda Server Action pede a sessão antes de tudo", () => {
    expect(map.actions.filter((a) => a.session === "none").map((a) => a.id)).toEqual([]);
  });
});

describe("as fronteiras com os serviços de fora", () => {
  it("todo arquivo da lista existe e faz uma chamada de rede", () => {
    for (const service of SERVICES) {
      for (const file of service.files) {
        expect(NETWORK_CALL.test(readFileSync(path.join(ROOT, file), "utf8")), file).toBe(true);
      }
    }
  });

  it("todo arquivo que faz uma chamada de rede está na lista (fronteira nova entra no mapa)", () => {
    const listed = new Set(SERVICES.flatMap((s) => s.files));
    const calling = [...productionFiles("apps/web/src"), ...productionFiles("packages")]
      .filter((f) => !f.includes(`${path.sep}flow-map${path.sep}`))
      .filter((f) => NETWORK_CALL.test(readFileSync(f, "utf8")))
      .map(rel);
    expect(calling.filter((f) => !listed.has(f))).toEqual([]);
  });
});
