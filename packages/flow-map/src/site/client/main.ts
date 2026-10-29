// O lado do navegador do site: o mapa do fluxo (uma tela nas quatro faixas e o detalhe da caixa
// escolhida) e o "quem usa" (o caminho ao contrário). Tudo montado com o DOM, sem innerHTML; o
// endereço (#tela=...&no=...) guarda a escolha, então voltar e compartilhar funcionam.
import type { DbFunction, FlowMap, Screen, Service } from "../../model";
import { fileOf, MapIndex, screenKey, shortName, type IndexedFn, type UsageKind } from "./index";

type Child = Node | string | null | undefined | false;

function h(
  tag: string,
  attrs: Record<string, string | boolean | undefined> = {},
  ...children: Child[]
): HTMLElement {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === false) continue;
    el.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children) if (c) el.append(c);
  return el;
}

const REPO = document.documentElement.dataset.repo ?? "danillo-valle/fintrack";
const codeUrl = (file: string) => `https://github.com/${REPO}/blob/main/${file}`;
const KIND_LABEL: Record<IndexedFn["kind"], string> = {
  loader: "Carregamento",
  action: "Ação do servidor",
  api: "Rota de API",
  worker: "Trabalhador de fila",
};
const SCREEN_KIND: Record<Screen["kind"], string> = {
  page: "página",
  modal: "modal",
  public: "pública",
  layout: "moldura",
};

function chip(text: string, tone = "", mono = false): HTMLElement {
  return h("span", { class: `chip ${tone}${mono ? " num" : ""}`.trim() }, text);
}

function sessionChip(session: string): HTMLElement {
  if (session === "recent") return chip("pede a senha de novo", "c1");
  if (session === "user") return chip("pede login", "c1");
  return chip("sem login", "c4");
}

function readHash(): URLSearchParams {
  return new URLSearchParams(location.hash.replace(/^#/, ""));
}

function writeHash(params: Record<string, string | undefined>) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) p.set(k, v);
  const next = `#${p.toString()}`;
  if (location.hash !== next) location.hash = next;
}

async function loadMap(): Promise<MapIndex> {
  const response = await fetch("fluxo.json");
  if (!response.ok) throw new Error(`fluxo.json: ${response.status}`);
  return new MapIndex((await response.json()) as FlowMap);
}

// ── O mapa do fluxo ──────────────────────────────────────────────────────────────────────────
function startFlow(index: MapIndex) {
  const list = document.getElementById("lista-telas") as HTMLElement;
  const search = document.getElementById("busca") as HTMLInputElement;
  const select = document.getElementById("tela-select") as HTMLSelectElement;
  const view = document.getElementById("tela") as HTMLElement;
  const areas = [...new Set(index.screens.map((s) => s.area))];
  const order = [
    "Início",
    "Lançamentos",
    "Orçamento",
    "Carteiras",
    "Ajustes",
    "Ajuda",
    "Convite",
    "Entrada",
    "Moldura",
    "Desenvolvimento",
  ];
  areas.sort((a, b) => ((order.indexOf(a) + 100) % 100) - ((order.indexOf(b) + 100) % 100));

  const label = (s: Screen) => (s.kind === "modal" ? `${s.title} (modal)` : s.title);

  // O seletor do celular: todas as telas, por área
  for (const area of areas) {
    const group = h("optgroup", { label: area });
    for (const s of index.screens.filter((x) => x.area === area)) {
      group.append(h("option", { value: screenKey(s) }, label(s)));
    }
    select.append(group);
  }
  select.addEventListener("change", () => writeHash({ tela: select.value }));

  function renderList(current: string) {
    const found = new Set(index.search(search.value));
    list.replaceChildren();
    let shown = 0;
    for (const area of areas) {
      const items = index.screens.filter((s) => s.area === area && found.has(s));
      if (!items.length) continue;
      shown += items.length;
      const ul = h("ul");
      for (const s of items) {
        const key = screenKey(s);
        ul.append(
          h(
            "li",
            {},
            h(
              "a",
              {
                href: `#tela=${encodeURIComponent(key)}`,
                "aria-current": key === current ? "page" : undefined,
              },
              label(s),
            ),
          ),
        );
      }
      list.append(h("div", { class: "grupo" }, h("h2", {}, area), ul));
    }
    const status = document.getElementById("busca-status") as HTMLElement;
    status.textContent = search.value.trim() ? `${shown} ${shown === 1 ? "tela" : "telas"}` : "";
  }
  search.addEventListener("input", () => renderList(readHash().get("tela") ?? ""));

  function render() {
    const params = readHash();
    const fallback =
      index.screenByKey("/ajustes/contas/nova") ?? index.screens.find((s) => s.kind === "page");
    const screen = index.screenByKey(params.get("tela") ?? "") ?? fallback;
    if (!screen) return;
    const key = screenKey(screen);
    select.value = key;
    renderList(key);
    const fnIds = [...screen.loaders, ...screen.actions];
    const chosen = params.get("no") ?? screen.actions[0] ?? screen.loaders[0] ?? "";
    view.replaceChildren(screenView(index, screen, fnIds, chosen));
    document.title = `${screen.title} · Mapa do fluxo · FinTrack por dentro`;
  }
  window.addEventListener("hashchange", render);
  render();
}

function nodeButton(
  kind: string,
  name: string,
  note: string,
  nodeKey: string,
  selected: boolean,
  screen: Screen,
): HTMLElement {
  return h(
    "a",
    {
      class: "no",
      href: `#tela=${encodeURIComponent(screenKey(screen))}&no=${encodeURIComponent(nodeKey)}`,
      "aria-current": selected ? "true" : undefined,
    },
    h("span", { class: "tipo" }, kind),
    h("span", { class: "nome num" }, name),
    note ? h("span", { class: "nota" }, note) : null,
  );
}

const ICONS: Record<string, string> = {
  monitor: "M3 4h18v12H3zM8 20h8M12 16v4",
  server: "M4 4h16v6H4zM4 14h16v6H4zM8 7h.01M8 17h.01",
  db: "M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3zM4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3",
  globe:
    "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM3 12h18M12 3c3 3.5 3 14.5 0 18M12 3c-3 3.5-3 14.5 0 18",
};

/** Um ícone de traço (decorativo: o título da faixa diz o que é). */
function icon(name: string): SVGSVGElement {
  const NS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(NS, "svg");
  for (const [k, v] of Object.entries({
    width: "18",
    height: "18",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    "stroke-width": "2",
    "stroke-linecap": "round",
    "stroke-linejoin": "round",
    "aria-hidden": "true",
  })) {
    svg.setAttribute(k, v);
  }
  const path = document.createElementNS(NS, "path");
  path.setAttribute("d", ICONS[name] ?? "");
  svg.append(path);
  return svg;
}

function lane(iconName: string, title: string, sub: string, ...content: Child[]): HTMLElement {
  return h(
    "section",
    { class: "faixa", "aria-label": title },
    h(
      "div",
      { class: "faixa-topo" },
      h("span", { class: "icone" }, icon(iconName)),
      h("span", {}, h("h3", {}, title), h("span", { class: "sub" }, sub)),
    ),
    ...content,
  );
}

function fnNote(fn: IndexedFn): string {
  const parts: string[] = [];
  if (fn.permissions.length) parts.push(`crachá ${fn.permissions.join(", ")}`);
  if (fn.enqueues.length) parts.push(`fila ${fn.enqueues.join(", ")}`);
  if (fn.services.length) parts.push("sai do servidor");
  return parts.join(" · ");
}

function screenView(index: MapIndex, screen: Screen, fnIds: string[], chosen: string): HTMLElement {
  const chosenFn = index.fns.get(chosen);
  const chosenDb = index.db.get(chosen);
  const scope = chosenFn
    ? [chosenFn.id]
    : chosenDb
      ? (index.callersOfDb.get(chosenDb.id) ?? []).filter((id) => fnIds.includes(id))
      : fnIds;
  const reach = index.reach(scope);

  const head = h(
    "div",
    { class: "tela-topo" },
    h("span", { class: "area" }, screen.area),
    h("h1", {}, screen.title),
    h(
      "div",
      { class: "chips" },
      chip(screen.route, "", true),
      chip(SCREEN_KIND[screen.kind]),
      screen.kind !== "layout" ? sessionChip(screen.session) : null,
      ...index
        .variants(screen)
        .map((v) =>
          h(
            "a",
            { class: "chip c4", href: `#tela=${encodeURIComponent(screenKey(v))}` },
            `também ${SCREEN_KIND[v.kind] === "modal" ? "em modal" : "em página inteira"}`,
          ),
        ),
      screen.help
        ? h(
            "a",
            { class: "chip", href: codeUrl("apps/web/src/features/help/content.ts") },
            `Ajuda: ${screen.help}`,
          )
        : null,
    ),
  );

  // No navegador
  const linkChips = screen.links.map((link) => {
    const target = index.linkTarget(link);
    return target && target !== screen
      ? h("a", { class: "chip num", href: `#tela=${encodeURIComponent(screenKey(target))}` }, link)
      : chip(link, "", true);
  });
  const browser = lane(
    "monitor",
    "No navegador",
    "o que roda no aparelho",
    screen.clientComponents.length
      ? h(
          "ul",
          { class: "arquivos" },
          ...screen.clientComponents.map((f) =>
            h(
              "li",
              {},
              h("a", { class: "num", href: codeUrl(f), title: f }, f.slice(f.lastIndexOf("/") + 1)),
            ),
          ),
        )
      : h("p", { class: "vazio" }, "Nada: a tela sai pronta do servidor."),
    screen.authCalls.length ? h("div", { class: "rotulo" }, "CHAMA O BETTER AUTH") : null,
    screen.authCalls.length
      ? h("div", { class: "chips" }, ...screen.authCalls.map((c) => chip(c, "c1", true)))
      : null,
    linkChips.length ? h("div", { class: "rotulo" }, "LEVA PARA") : null,
    linkChips.length ? h("div", { class: "chips" }, ...linkChips) : null,
  );

  // No servidor
  const fnButtons = (ids: string[]) =>
    ids.map((id) => {
      const fn = index.fns.get(id) as IndexedFn;
      return nodeButton(
        fn.kind === "action" ? "ação" : "carregamento",
        fn.name,
        fnNote(fn),
        id,
        id === chosen,
        screen,
      );
    });
  const server = lane(
    "server",
    "No servidor",
    "Next.js, antes e depois do clique",
    screen.loaders.length ? h("div", { class: "rotulo" }, "AO ABRIR") : null,
    ...fnButtons(screen.loaders),
    screen.actions.length ? h("div", { class: "rotulo" }, "AO ENVIAR") : null,
    ...fnButtons(screen.actions),
    !fnIds.length
      ? h(
          "p",
          { class: "vazio" },
          screen.kind === "layout"
            ? "A moldura só desenha o menu e o tema."
            : "Esta tela não carrega nem envia nada ao servidor do app.",
        )
      : null,
  );

  // No banco
  const dbButtons = reach.db.map((id) => {
    const d = index.db.get(id) as DbFunction;
    return nodeButton(
      "função",
      d.name,
      d.file.replace("packages/db/src/", "packages/db/"),
      id,
      id === chosen,
      screen,
    );
  });
  const database = lane(
    "db",
    "No banco",
    chosenFn ? `o que ${chosenFn.name} toca` : "packages/db e as tabelas",
    ...dbButtons,
    reach.tables.length
      ? h(
          "div",
          { class: "chips" },
          ...reach.tables.map((t) =>
            h(
              "a",
              { class: "chip c5 num", href: `quem-usa.html#tabela=${encodeURIComponent(t)}` },
              t,
            ),
          ),
        )
      : null,
    !reach.db.length && !reach.tables.length
      ? h("p", { class: "vazio" }, "Não toca no banco.")
      : null,
  );

  // Lá fora
  const services = reach.services.map(
    (id) => index.map.services.find((s) => s.id === id) as Service,
  );
  const outside = lane(
    "globe",
    "Lá fora",
    "serviços de terceiros",
    services.length
      ? h(
          "ul",
          { class: "servicos" },
          ...services.map((s) =>
            h(
              "li",
              {},
              h("a", { href: `quem-usa.html#servico=${s.id}` }, s.name),
              h("span", { class: "nota" }, s.description),
            ),
          ),
        )
      : h(
          "p",
          { class: "vazio" },
          chosenFn
            ? "Esta caixa não sai do servidor de casa."
            : "Esta tela não sai do servidor de casa.",
        ),
  );

  const trail = h(
    "div",
    { class: "trilha" },
    browser,
    hop("POST da ação"),
    server,
    hop("Prisma"),
    database,
    hop("HTTPS"),
    outside,
  );

  return h(
    "div",
    { class: "tela-corpo" },
    head,
    trail,
    detail(index, screen, chosenFn, chosenDb),
    h(
      "p",
      { class: "dica" },
      "Escolha uma caixa para ver o que ela recebe, pede, faz e quem a chama. O endereço desta página guarda a tela e a caixa escolhidas.",
    ),
  );
}

function hop(text: string): HTMLElement {
  return h(
    "div",
    { class: "salto", "aria-hidden": "true" },
    h("span", { class: "seta" }),
    h("span", {}, text),
  );
}

function row(title: string, ...content: Child[]): HTMLElement {
  return h("div", { class: "linha" }, h("h3", {}, title), ...content);
}

function callers(index: MapIndex, fnId: string): HTMLElement {
  const screens = index.screensOfFn.get(fnId) ?? [];
  if (!screens.length)
    return h(
      "p",
      { class: "vazio" },
      "Nenhuma tela: é chamada por uma rota de API ou por uma fila.",
    );
  return h(
    "div",
    { class: "chips" },
    ...screens.map((s) =>
      h(
        "a",
        {
          class: "chip",
          href: `#tela=${encodeURIComponent(screenKey(s))}&no=${encodeURIComponent(fnId)}`,
        },
        `${s.title} · ${SCREEN_KIND[s.kind]}`,
      ),
    ),
  );
}

function detail(
  index: MapIndex,
  screen: Screen,
  fn: IndexedFn | undefined,
  db: DbFunction | undefined,
): HTMLElement {
  const box = h("section", {
    class: "detalhe",
    "aria-live": "polite",
    "aria-label": "Detalhe da caixa escolhida",
  });
  if (fn) {
    const does: Child[] = [];
    for (const d of fn.db)
      does.push(h("li", {}, "chama ", h("span", { class: "num" }, shortName(d)), " (packages/db)"));
    if (fn.tables.length) does.push(h("li", {}, `usa direto ${fn.tables.join(", ")}`));
    for (const q of fn.enqueues)
      does.push(
        h(
          "li",
          {},
          "põe trabalho na fila ",
          h("a", { class: "num", href: `quem-usa.html#fila=${encodeURIComponent(q)}` }, q),
        ),
      );
    for (const s of fn.services)
      does.push(h("li", {}, `alcança ${index.map.services.find((x) => x.id === s)?.name ?? s}`));
    if (fn.financeChanged) does.push(h("li", {}, "avisa o cache das somas (financeChanged)"));
    for (const r of fn.redirects)
      does.push(h("li", {}, "manda o navegador para ", h("span", { class: "num" }, r)));
    box.append(
      h(
        "div",
        { class: "detalhe-topo" },
        h("span", { class: "tipo" }, KIND_LABEL[fn.kind]),
        h("h2", { class: "num" }, fn.name),
        h("a", { href: codeUrl(fn.file), class: "arquivo" }, fn.file.replace("apps/web/src/", "")),
      ),
      h(
        "div",
        { class: "linhas" },
        row(
          "O que chega",
          fn.input.length
            ? h("div", { class: "chips" }, ...fn.input.map((f) => chip(f, "", true)))
            : h(
                "p",
                { class: "vazio" },
                fn.kind === "loader"
                  ? "A sessão e o que a tela passa (os parâmetros do endereço)."
                  : "Nada além da sessão.",
              ),
        ),
        row(
          "O que pede",
          h(
            "div",
            { class: "chips" },
            fn.kind === "loader" && fn.session === "none"
              ? chip("login (a tela pede antes)", "c1")
              : sessionChip(fn.session),
            ...fn.permissions.map((p) => chip(`crachá ${p}`, "c1")),
          ),
        ),
        row(
          "O que faz",
          does.length ? h("ul", {}, ...does) : h("p", { class: "vazio" }, "Só lê: nada muda."),
        ),
        row("Quem chama", callers(index, fn.id)),
      ),
    );
    if (fn.rules.length) {
      (box.querySelector(".linhas") as HTMLElement).append(
        row(
          "Regras puras usadas",
          h(
            "div",
            { class: "chips" },
            ...fn.rules.map((r) =>
              h(
                "a",
                { class: "chip num", href: `quem-usa.html#regra=${encodeURIComponent(r)}` },
                shortName(r),
              ),
            ),
          ),
        ),
      );
    }
    return box;
  }
  if (db) {
    const fns = (index.callersOfDb.get(db.id) ?? []).map((id) => index.fns.get(id) as IndexedFn);
    box.append(
      h(
        "div",
        { class: "detalhe-topo" },
        h("span", { class: "tipo" }, "Função do banco"),
        h("h2", { class: "num" }, db.name),
        h("a", { href: codeUrl(db.file), class: "arquivo" }, db.file),
      ),
      h(
        "div",
        { class: "linhas" },
        row(
          "Tabelas",
          db.tables.length
            ? h(
                "div",
                { class: "chips" },
                ...db.tables.map((t) =>
                  h(
                    "a",
                    { class: "chip c5 num", href: `quem-usa.html#tabela=${encodeURIComponent(t)}` },
                    t,
                  ),
                ),
              )
            : h("p", { class: "vazio" }, "Nenhuma direto (só regra ou crachá)."),
        ),
        row(
          "Lá fora",
          db.services.length
            ? h(
                "p",
                {},
                db.services
                  .map((s) => index.map.services.find((x) => x.id === s)?.name ?? s)
                  .join(", "),
              )
            : h("p", { class: "vazio" }, "Não sai do servidor."),
        ),
        row(
          "Quem chama",
          h(
            "div",
            { class: "chips" },
            ...fns.map((f) =>
              h(
                "a",
                {
                  class: "chip num",
                  href: `#tela=${encodeURIComponent(screenKey((index.screensOfFn.get(f.id) ?? [screen])[0] as Screen))}&no=${encodeURIComponent(f.id)}`,
                },
                f.name,
              ),
            ),
          ),
        ),
      ),
    );
    return box;
  }
  box.append(h("p", { class: "vazio" }, "Escolha uma caixa nas faixas acima."));
  return box;
}

// ── Quem usa ─────────────────────────────────────────────────────────────────────────────────
const USAGE_KINDS: { kind: UsageKind; label: string }[] = [
  { kind: "tabela", label: "Tabela" },
  { kind: "fila", label: "Fila" },
  { kind: "servico", label: "Serviço" },
  { kind: "regra", label: "Regra" },
];

function startUsers(index: MapIndex) {
  const tabs = document.getElementById("tipos") as HTMLElement;
  const select = document.getElementById("qual") as HTMLSelectElement;
  const out = document.getElementById("resultado") as HTMLElement;

  function current(): { kind: UsageKind; name: string } {
    const params = readHash();
    for (const { kind } of USAGE_KINDS) {
      const name = params.get(kind);
      if (name) return { kind, name };
    }
    return { kind: "servico", name: "pluggy" };
  }

  function render() {
    const { kind, name } = current();
    tabs.replaceChildren(
      ...USAGE_KINDS.map((k) =>
        h(
          "a",
          {
            href: `#${k.kind}=${encodeURIComponent(index.options(k.kind)[0]?.value ?? "")}`,
            "aria-current": k.kind === kind ? "true" : undefined,
          },
          k.label,
        ),
      ),
    );
    const options = index.options(kind);
    select.replaceChildren(...options.map((o) => h("option", { value: o.value }, o.label)));
    select.value = name;
    const usage = index.usersOf(kind, name);
    const service = kind === "servico" ? index.map.services.find((s) => s.id === name) : undefined;
    const title = service?.name ?? (kind === "regra" ? shortName(name) : name);
    const sub =
      service?.description ??
      (kind === "tabela"
        ? `tabela ${index.map.tables.find((t) => t.model === name)?.table ?? ""}`
        : kind === "regra"
          ? fileOf(name)
          : "fila do pg-boss");
    const col = (titleText: string, count: number, items: Child[]) =>
      h(
        "section",
        { class: "coluna" },
        h("h2", {}, `${titleText} `, h("span", { class: "num conta" }, String(count))),
        items.length ? h("ul", {}, ...items) : h("p", { class: "vazio" }, "Nenhuma."),
      );
    out.replaceChildren(
      h("div", { class: "escolhido" }, h("strong", {}, title), h("span", {}, sub)),
      h(
        "div",
        { class: "colunas" },
        col(
          "Telas",
          usage.screens.length,
          usage.screens.map((s) =>
            h(
              "li",
              {},
              h("a", { href: `fluxo.html#tela=${encodeURIComponent(screenKey(s))}` }, s.title),
              h("span", { class: "nota" }, `${s.route} · ${SCREEN_KIND[s.kind]}`),
            ),
          ),
        ),
        col(
          "Ações e carregamentos",
          usage.fns.length,
          usage.fns.map((f) =>
            h(
              "li",
              {},
              h("a", { class: "num", href: codeUrl(f.file) }, f.name),
              h("span", { class: "nota" }, KIND_LABEL[f.kind]),
            ),
          ),
        ),
        col("Filas e banco", usage.queues.length + usage.db.length, [
          ...usage.queues.map((q) =>
            h(
              "li",
              {},
              h("span", { class: "num" }, q.name),
              h(
                "span",
                { class: "nota" },
                q.schedule ? `fila, também às ${q.schedule} (cron)` : "fila",
              ),
            ),
          ),
          ...usage.db.map((d) =>
            h(
              "li",
              {},
              h("a", { class: "num", href: codeUrl(d.file) }, d.name),
              h("span", { class: "nota" }, d.file),
            ),
          ),
        ]),
      ),
    );
    document.title = `${title} · Quem usa · FinTrack por dentro`;
  }
  select.addEventListener("change", () => writeHash({ [current().kind]: select.value }));
  window.addEventListener("hashchange", render);
  render();
}

// ── Começo ───────────────────────────────────────────────────────────────────────────────────
async function start() {
  const page = document.body.dataset.page;
  if (page !== "fluxo" && page !== "quem-usa") return;
  const target = document.getElementById(page === "fluxo" ? "tela" : "resultado") as HTMLElement;
  try {
    const index = await loadMap();
    if (page === "fluxo") startFlow(index);
    else startUsers(index);
  } catch {
    target.replaceChildren(
      h(
        "p",
        { class: "vazio" },
        "Não deu para carregar o mapa. Os mesmos dados estão em fluxo.json.",
      ),
    );
  }
}

void start();
