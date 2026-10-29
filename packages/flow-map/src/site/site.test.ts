import { describe, expect, it } from "vitest";
import type { FlowMap, Screen, ServerFunction } from "../model";
import { MapIndex, routeMatches, screenKey } from "./client/index";
import { sizeOf, withSize } from "./diagrams";
import { esc } from "./html";
import { c4Sections, markdownBlocks } from "./markdown";

const fn = (id: string, extra: Partial<ServerFunction> = {}): ServerFunction => ({
  id,
  file: id.split("#")[0] as string,
  name: id.split("#")[1] as string,
  input: [],
  permissions: [],
  db: [],
  tables: [],
  enqueues: [],
  services: [],
  rules: [],
  redirects: [],
  financeChanged: false,
  session: "user",
  ...extra,
});

const screen = (route: string, kind: Screen["kind"], extra: Partial<Screen> = {}): Screen => ({
  route,
  file: `apps/web/src/app/(app)${route}/page.tsx`,
  kind,
  title: route,
  area: "Ajustes",
  help: null,
  params: [],
  searchParams: [],
  searchParamsTo: [],
  session: "user",
  loaders: [],
  actions: [],
  clientComponents: [],
  authCalls: [],
  links: [],
  ...extra,
});

const A = "apps/web/src/features/x/server/actions.ts#salvar";
const L = "apps/web/src/features/x/server/queries.ts#carregar";
const D = "packages/db/src/x.ts#gravar";
const MAP: FlowMap = {
  version: 1,
  screens: [
    screen("/x/[id]", "page", { title: "Coisa", actions: [A], loaders: [L] }),
    screen("/x/[id]", "modal", { title: "Coisa", actions: [A] }),
    screen("/", "layout", { file: "apps/web/src/app/(app)/layout.tsx" }),
  ],
  loaders: [fn(L, { tables: ["Wallet"] })],
  actions: [
    fn(A, { db: [D], enqueues: ["fila-x"], rules: ["packages/core/src/money.ts#toCents"] }),
  ],
  apis: [],
  queues: [
    {
      name: "fila-x",
      enqueuedBy: [A],
      schedule: null,
      worker: fn("w#work(fila-x)", { services: ["pluggy"] }),
    },
  ],
  db: [{ id: D, file: "packages/db/src/x.ts", name: "gravar", tables: ["AuditLog"], services: [] }],
  tables: [
    { model: "AuditLog", table: "audit_log" },
    { model: "Wallet", table: "wallet" },
    { model: "Session", table: "session" },
  ],
  services: [{ id: "pluggy", name: "Meu Pluggy", description: "", files: [] }],
};

describe("os índices do mapa (o que o site usa nos dois sentidos)", () => {
  const index = new MapIndex(MAP);

  it("dá uma chave por tela: a rota, o modal com ~modal e a moldura pelo grupo", () => {
    expect(MAP.screens.map(screenKey)).toEqual(["/x/[id]", "/x/[id]~modal", "moldura-(app)"]);
  });

  it("acha a tela de destino de um link com parte variável, sempre a página inteira", () => {
    expect(routeMatches("/x/[id]", "/x/[…]")).toBe(true);
    expect(routeMatches("/x/[id]", "/x/abc/y")).toBe(false);
    expect(index.linkTarget("/x/[…]")?.kind).toBe("page");
  });

  it("junta o que uma função alcança: as funções do banco, as tabelas delas e as diretas", () => {
    expect(index.reach([A, L])).toEqual({ db: [D], tables: ["AuditLog", "Wallet"], services: [] });
  });

  it("quem usa uma tabela, uma fila, um serviço e uma regra, até as telas", () => {
    const audit = index.usersOf("tabela", "AuditLog");
    expect(audit.fns.map((f) => f.name)).toEqual(["salvar"]);
    expect(audit.screens.map(screenKey)).toEqual(["/x/[id]~modal", "/x/[id]"]);
    expect(index.usersOf("fila", "fila-x").queues.map((q) => q.name)).toEqual(["fila-x"]);
    expect(index.usersOf("servico", "pluggy").queues.map((q) => q.name)).toEqual(["fila-x"]);
    expect(index.usersOf("regra", "packages/core/src/money.ts#toCents").screens).toHaveLength(2);
  });

  it("não oferece no 'quem usa' a tabela que ninguém usa", () => {
    expect(index.options("tabela").map((o) => o.value)).toEqual(["AuditLog", "Wallet"]);
  });

  it("a busca acha a tela pelo título sem acento, pela ação e pela tabela que ela toca", () => {
    expect(index.search("coisa").length).toBe(2);
    expect(index.search("salvar").length).toBe(2);
    expect(index.search("auditlog").length).toBe(2);
    expect(index.search("wallet").map(screenKey)).toEqual(["/x/[id]"]);
  });
});

describe("o markdown do c4.md", () => {
  it("escapa tudo, e só então põe negrito, código e link https", () => {
    const html = markdownBlocks(
      "- **Banco só em `features/*/server`** <script>\n  continua [doc](https://x.dev/a)",
    );
    expect(html).toBe(
      '<ul><li><strong>Banco só em <code class="num">features/*/server</code></strong> &lt;script&gt; continua <a href="https://x.dev/a">doc</a></li></ul>',
    );
    expect(markdownBlocks("[x](javascript:alert(1))")).not.toContain("<a ");
  });

  it("separa as seções do C4 com o diagrama e o texto depois dele", () => {
    const sections = c4Sections(
      "# T\n\n## Nível 1 · Contexto\n\n```mermaid\nflowchart TB\n  a --> b\n```\n\n- nota\n",
    );
    expect(sections).toEqual([
      {
        title: "Nível 1 · Contexto",
        id: "c4-nivel-1",
        mermaid: "flowchart TB\n  a --> b\n",
        notes: "- nota",
      },
    ]);
  });
});

describe("o SVG do Mermaid como imagem", () => {
  it("troca a largura de 100% pelo tamanho do viewBox", () => {
    const svg = withSize(
      '<svg id="d" width="100%" xmlns="x" style="max-width: 950px;" viewBox="4 4 950.4 735"><g/></svg>',
    );
    expect(svg.startsWith('<svg id="d" width="951" height="735" xmlns="x" viewBox')).toBe(true);
    expect(sizeOf(svg)).toEqual({ width: 951, height: 735 });
  });

  it("escapa aspas e sinais no HTML", () => {
    expect(esc(`<a href="x">'&'</a>`)).toBe(
      "&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;",
    );
  });
});
