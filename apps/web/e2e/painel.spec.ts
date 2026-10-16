// O painel do M08 de ponta a ponta (ADR-010), nos dois aparelhos:
//
//   1. Início: cada número leva à lista de lançamentos, e a lista soma o MESMO valor. A lista
//      mostra o caminho de volta e os filtros que formaram o número.
//   2. Orçamento: copiar do mês anterior (e desfazer), dividir por pessoa, a regra de nível
//      (categoria de cima ou as de baixo) e o filtro "Pago por".
//   3. Fluxo de caixa: resultado = entradas − saídas, e o detalhe do mês leva às listas.
//   4. Evolução: a categoria de baixo no seletor, o orçado e a barra de cada mês até a lista.
//   5. 24 meses de seed: o painel abre em menos de 1 s (só no desktop e só contra o build de
//      produção, PLAYWRIGHT_PRODUCTION=1; no pnpm dev o teste é pulado).
//   6. Regras de layout que dependem do navegador, conferidas no estilo calculado (o Safari do
//      Mac não roda aqui: o manual pede a conferência à mão).
//
// Dados sintéticos: nomes inventados e finais de cartão 0002 e 0003.
import { execFileSync } from "node:child_process";
import { expect, type Browser, type Page, type TestInfo } from "@playwright/test";
import {
  brl,
  clearMoney,
  clickAndWait,
  createFinanceDirect,
  createHouseholdDirect,
  createTestUser,
  deleteHouseholds,
  expectNoA11yViolations,
  NO_SESSION,
  openPage,
  personInNewTab,
  PRODUCTION_BUILD,
  serverAction,
  signInThroughUi,
  sql,
  test,
  testEmail,
  todaySaoPaulo,
} from "./helpers";

const created: string[] = [];
test.afterEach(async () => {
  await deleteHouseholds(created.splice(0));
});

function device(testInfo: TestInfo) {
  const mobile = testInfo.project.name === "celular";
  return mobile ? { viewport: { width: 412, height: 915 }, isMobile: true } : {};
}

// ── Datas do teste: o mês de hoje e os dois anteriores ──────────────────────────
const today = todaySaoPaulo();
const month = today.slice(0, 7);
function addMonths(key: string, delta: number) {
  const [y, m] = key.split("-").map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
const last = addMonths(month, -1);
const before = addMonths(month, -2);
const monthName = (key: string) =>
  new Intl.DateTimeFormat("pt-BR", { month: "long", timeZone: "UTC" }).format(
    new Date(`${key}-15T12:00:00Z`),
  );

/** "− R$ 1.234,56" → 123456n (o texto do resumo da lista, em centavos e sem sinal). */
function centsOf(text: string): bigint {
  const match = text.replace(/\s+/g, " ").match(/R\$ ?([\d.]+),(\d{2})/);
  if (!match) throw new Error(`sem valor em "${text}"`);
  return BigInt(`${match[1]!.replaceAll(".", "")}${match[2]}`);
}

/** Abre o link de um número e confere que a lista soma o mesmo (saídas ou entradas). */
async function expectListMatches(
  page: Page,
  link: ReturnType<Page["locator"]>,
  kind: "saidas" | "entradas",
) {
  const cents = BigInt((await link.getAttribute("data-cents")) ?? "x");
  const href = await link.getAttribute("href");
  expect(href).toMatch(/^\/lancamentos\?/);
  await openPage(page, href!);
  const total = centsOf(await page.getByTestId(`total-${kind}`).innerText());
  expect(total, `lista de ${href}`).toBe(cents < 0n ? -cents : cents);
  return href!;
}

/**
 * Bruna (logada) e Caio num lar, com o ambiente Casa dos dois. Na Casa: a conta (titular Bruna)
 * e o cartão da casa (titular Caio, fecha 3, vence 10) com o "Master conjunto" de compras
 * conjuntas. Categorias: Alimentação > Mercado e Padaria; Lazer. Lançamentos neste mês (dia 1),
 * no anterior e dois meses atrás; orçado do mês anterior com o Mercado dividido (e, com
 * `budgetThisMonth`, o mesmo orçado também neste mês, como a cópia do mês anterior deixaria).
 */
async function household(
  browser: Browser,
  testInfo: TestInfo,
  slug: string,
  { budgetThisMonth = false }: { budgetThisMonth?: boolean } = {},
) {
  const bruna = testEmail(`${slug}-bruna`, testInfo.project.name);
  const caio = testEmail(`${slug}-caio`, testInfo.project.name);
  const person = await personInNewTab(browser, bruna, "Bruna Prado", device(testInfo));
  await createTestUser(person.page.request, {
    email: caio,
    password: "frase longa para o caio do teste",
    name: "Caio Lima",
    twoFactor: false,
  });
  const home = await createHouseholdDirect({
    name: `Lar ${slug}`,
    people: [
      { email: bruna, role: "OWNER" },
      { email: caio, role: "MEMBER" },
    ],
    shared: [
      {
        name: "Casa",
        members: [
          { email: bruna, role: "OWNER" },
          { email: caio, role: "EDITOR" },
        ],
      },
    ],
  });
  created.push(home.householdId);
  const casa = home.shared["Casa"]!;
  const day = (key: string, d: number) => `${key}-${String(d).padStart(2, "0")}`;
  const finance = await createFinanceDirect({
    householdId: home.householdId,
    accounts: [
      { walletId: casa, name: "Conta da Casa", kind: "CHECKING", holderEmail: bruna },
      {
        walletId: casa,
        name: "Cartão da casa",
        kind: "CREDIT_CARD",
        holderEmail: caio,
        closingDay: 3,
        dueDay: 10,
        cards: [
          { nickname: "Visa do Caio", lastFour: "0002", holderEmail: caio },
          {
            nickname: "Master conjunto",
            lastFour: "0003",
            holderEmail: caio,
            sharedPurchases: true,
          },
        ],
      },
    ],
    categories: [
      { name: "Alimentação", kind: "EXPENSE" },
      { name: "Mercado", kind: "EXPENSE" },
      { name: "Padaria", kind: "EXPENSE" },
      { name: "Lazer", kind: "EXPENSE" },
    ],
    transactions: [
      // Este mês, dia 1 (sempre até hoje)
      {
        walletId: casa,
        account: "Conta da Casa",
        amount: "-100.00",
        occurredOn: day(month, 1),
        description: "Feira do mês",
        category: "Mercado",
      },
      {
        walletId: casa,
        account: "Cartão da casa",
        card: "Master conjunto",
        amount: "-60.00",
        occurredOn: day(month, 1),
        description: "Atacado",
        category: "Mercado",
      },
      {
        walletId: casa,
        account: "Conta da Casa",
        amount: "-15.50",
        occurredOn: day(month, 1),
        description: "Pão de sábado",
        category: "Padaria",
      },
      {
        walletId: casa,
        account: "Conta da Casa",
        amount: "1000.00",
        occurredOn: day(month, 1),
        description: "Reembolso da casa",
      },
      // Mês passado e retrasado
      {
        walletId: casa,
        account: "Conta da Casa",
        amount: "-300.00",
        occurredOn: day(last, 5),
        description: "Compra do mês",
        category: "Mercado",
      },
      {
        walletId: casa,
        account: "Conta da Casa",
        amount: "-20.00",
        occurredOn: day(last, 6),
        description: "Padaria",
        category: "Padaria",
      },
      {
        walletId: casa,
        account: "Conta da Casa",
        amount: "-250.00",
        occurredOn: day(before, 5),
        description: "Compra antiga",
        category: "Mercado",
      },
    ],
  });
  const cat = finance.categories;
  for (const child of ["Mercado", "Padaria"]) {
    await sql(`UPDATE category SET "parentId" = $1 WHERE id = $2`, [
      cat["Alimentação"],
      cat[child],
    ]);
  }
  // O orçado do mês anterior: Mercado R$ 500 (Bruna 200, Compartilhado 300) e Lazer R$ 100
  const brunaId = (await sql<{ id: string }>('SELECT id FROM "user" WHERE email = $1', [bruna]))[0]!
    .id;
  for (const key of budgetThisMonth ? [last, month] : [last]) {
    const budget = async (category: string, amount: string) => {
      const [row] = await sql<{ id: string }>(
        `INSERT INTO budget (id, "householdId", "walletId", "categoryId", month, amount, "updatedAt")
         VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, now()) RETURNING id`,
        [home.householdId, casa, cat[category], `${key}-01`, amount],
      );
      return row!.id;
    };
    const market = await budget("Mercado", "500.00");
    await budget("Lazer", "100.00");
    for (const [userId, amount] of [
      [brunaId, "200.00"],
      [null, "300.00"],
    ] as const) {
      await sql(
        `INSERT INTO budget_share (id, "householdId", "budgetId", "userId", amount, "updatedAt")
         VALUES (gen_random_uuid(), $1, $2, $3, $4, now())`,
        [home.householdId, market, userId, amount],
      );
    }
  }
  return { ...person, casa, categories: cat };
}

test.describe("Início", () => {
  test("cada número leva à lista, que soma o mesmo valor e mostra o caminho de volta", async ({
    browser,
  }, testInfo) => {
    const p = await household(browser, testInfo, "inicio");
    const page = p.page;
    await openPage(page, "/");
    await expect(page.getByRole("region", { name: /^Resumo de / })).toBeVisible();
    await expectNoA11yViolations(page);

    // Gasto até hoje: 100 + 60 + 15,50
    const spent = page.getByTestId("inicio-gasto").getByRole("link");
    await expect(spent).toHaveAttribute("data-cents", "17550");
    await expectListMatches(page, spent, "saidas");
    // O caminho de volta e os filtros que formaram o número
    await expect(page.getByRole("link", { name: /Início/ }).first()).toHaveAttribute(
      "href",
      /^\/(\?|$)/,
    );
    const filters = page.getByRole("group", { name: "Filtros ativos" });
    await expect(filters).toBeVisible();
    await expect(filters.locator("[data-filter=periodo]")).toBeVisible();

    // Entradas: o reembolso
    await openPage(page, "/");
    await expectListMatches(
      page,
      page.getByTestId("inicio-entradas").getByRole("link"),
      "entradas",
    );

    // Cada categoria do gráfico (gasto até hoje)
    await openPage(page, "/");
    const groups = page.getByTestId("grupo-gasto");
    const hrefs = await groups.evaluateAll((links) =>
      links.map((a) => [a.getAttribute("href"), a.getAttribute("data-cents")] as const),
    );
    expect(hrefs.length).toBeGreaterThan(0);
    for (const [href, cents] of hrefs) {
      await openPage(page, href!);
      expect(centsOf(await page.getByTestId("total-saidas").innerText())).toBe(BigInt(cents!));
    }
    // A categoria vem com as de baixo: Alimentação = Mercado + Padaria
    await expect(page.getByRole("group", { name: "Filtros ativos" })).toContainText("Alimentação");
    await expect(page.getByRole("link", { name: "Feira do mês" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Pão de sábado" })).toBeVisible();
    // Tirar o filtro de categoria pelo ×
    await page.getByRole("link", { name: /Tirar o filtro Categoria: Alimentação/ }).click();
    await expect(page).not.toHaveURL(/categoria=/);
    const left = page.getByRole("group", { name: "Filtros ativos" });
    await expect(left).not.toContainText("Alimentação");
    await expect(left).toContainText("Só despesas");
    await p.close();
  });
});

test.describe("Orçamento", () => {
  // M10.0: eram um teste só ("…dividir por pessoa e o Pago por"). Com a máquina ocupada, o teste
  // inteiro chegava a 27–29 s dos 30 s de limite; dividido, cada parte tem o próprio lar e o
  // próprio limite, e nenhuma conferência saiu.
  test("copiar do mês anterior, desfazer, dividir por pessoa e a regra de nível", async ({
    browser,
  }, testInfo) => {
    const p = await household(browser, testInfo, "orcamento");
    const page = p.page;
    await openPage(page, `/orcamento?carteira=${p.casa}`);
    await expect(page.getByText(/Nenhuma categoria orçada/)).toBeVisible();

    // Copiar: as duas categorias do mês passado, com a divisão do Mercado. Cada aviso vem da
    // resposta da Server Action: o teste espera a resposta (o estado) e só então confere o aviso
    // (M10.0: no N150, com a suíte inteira, a resposta passava dos 5 s do expect)
    const copy = page
      .getByRole("button", { name: `Copiar de ${monthName(last)}` })
      .filter({ visible: true });
    await clickAndWait(copy, serverAction);
    await expect(page.getByText("Copiado do mês anterior: 2 categorias novas.")).toBeVisible();
    const rows = page.getByTestId("orcamento-linhas");
    await expect(rows.locator("li[data-category]")).toHaveCount(2);
    await expect(rows).toContainText("Compartilhado");

    // Desfazer: volta ao vazio
    await clickAndWait(page.getByRole("button", { name: "Desfazer" }), serverAction);
    await expect(page.getByText("Cópia desfeita.")).toBeVisible();
    await expect(page.getByText(/Nenhuma categoria orçada/)).toBeVisible();

    // Copiar de novo; a segunda cópia não tem o que copiar
    await clickAndWait(copy, serverAction);
    await expect(page.getByText("Copiado do mês anterior: 2 categorias novas.")).toBeVisible();
    await clickAndWait(copy, serverAction);
    await expect(page.getByText(/Nada a copiar/)).toBeVisible();

    // Editar valores: a parte da Bruna sobe para R$ 250; o orçado é a soma (R$ 550). O modal é uma
    // rota interceptada: a URL muda quando a resposta chega, e o modal vem junto com ela
    const editar = page.getByRole("link", { name: "Editar valores" }).filter({ visible: true });
    await editar.click();
    await page.waitForURL(/\/orcamento\/editar/);
    const modal = page.getByRole("dialog", { name: "Editar valores" });
    await expect(modal).toBeVisible();
    await expectNoA11yViolations(page);
    await modal
      .getByLabel("Categoria", { exact: true })
      .selectOption({ label: "Alimentação › Mercado (já orçada)" });
    await expect(modal.getByLabel("Dividir por pessoa")).toBeChecked();
    const bruna = modal.getByLabel("Bruna", { exact: true });
    // M10.0: zera pelo helper (o fill("") às vezes tirava só um dígito; ver clearMoney) e confere
    // a soma inteira: o trecho /550,00/ aceitava "R$ 2.000.550,00" e o erro só aparecia no aviso
    await clearMoney(bruna);
    await bruna.pressSequentially("25000");
    await expect(modal.getByTestId("soma-partes")).toHaveText(brl("R$ 550,00"));
    await clickAndWait(modal.getByRole("button", { name: "Salvar" }), serverAction);
    await expect(
      page.getByText("Orçado de R$ 550,00 salvo.").filter({ visible: true }),
    ).toBeVisible();
    await expect(modal).toBeHidden();
    const market = rows.locator(`li[data-category="${p.categories["Mercado"]}"]`);
    await expect(market).toContainText("550,00");

    // Regra de nível: Alimentação não pode ter orçado junto com o Mercado
    await editar.click();
    await page.waitForURL(/\/orcamento\/editar/);
    await modal.getByLabel("Categoria", { exact: true }).selectOption({ label: "Alimentação" });
    await modal.getByLabel("Orçado no mês").pressSequentially("10000");
    await clickAndWait(modal.getByRole("button", { name: "Salvar" }), serverAction);
    await expect(modal.getByRole("alert")).toContainText(/Alimentação|categoria de cima|de baixo/);
    await modal.getByRole("button", { name: "Cancelar" }).click();
    await expect(modal).toBeHidden();
    await p.close();
  });

  test("o gasto da linha leva à lista, e o Pago por mostra a parte de cada um", async ({
    browser,
  }, testInfo) => {
    // O orçado deste mês já gravado, como a cópia do mês anterior deixa (o teste de cima prova a cópia)
    const p = await household(browser, testInfo, "orcamento-pago", { budgetThisMonth: true });
    const page = p.page;
    await openPage(page, `/orcamento?carteira=${p.casa}`);
    const rows = page.getByTestId("orcamento-linhas");
    const market = rows.locator(`li[data-category="${p.categories["Mercado"]}"]`);
    await expect(market).toContainText("500,00");

    // O gasto da linha leva à lista com o mesmo total
    await expectListMatches(page, market.getByTestId("linha-gasto"), "saidas");
    await expect(page.getByRole("link", { name: /Orçamento · Mercado/ })).toBeVisible();

    // Pago por Compartilhado: o orçado da linha é a parte (R$ 300) e o gasto, o do cartão conjunto
    await openPage(page, `/orcamento?carteira=${p.casa}&pago=compartilhado`);
    await expect(market).toContainText("300,00");
    await expect(market.getByTestId("linha-gasto")).toHaveAttribute("data-cents", "6000");
    await expectListMatches(page, market.getByTestId("linha-gasto"), "saidas");
    await expectNoA11yViolations(page);
    await p.close();
  });
});

test.describe("Fluxo de caixa e Evolução", () => {
  test("o resultado é entradas menos saídas, e o detalhe leva às listas", async ({
    browser,
  }, testInfo) => {
    const p = await household(browser, testInfo, "fluxo");
    const page = p.page;
    await openPage(page, `/orcamento/fluxo?carteira=${p.casa}`);
    await expectNoA11yViolations(page);

    // No computador, a tabela; no celular, os cartões. Os dois com os mesmos números.
    const mobile = testInfo.project.name === "celular";
    const current = mobile
      ? page.getByTestId("fluxo-cartoes").locator("li").first()
      : page.getByTestId("fluxo-tabela").locator(`tr[data-month="${month}"]`);
    const values = await current
      .locator("[data-cents]")
      .evaluateAll((els) => els.map((e) => BigInt(e.getAttribute("data-cents") ?? "0")));
    // Tabela: entradas, fixas, outras, resultado. Cartão: resultado, entradas, fixas, outras.
    const [income, fixed, other, net] = mobile
      ? [values[1]!, values[2]!, values[3]!, values[0]!]
      : [values[0]!, values[1]!, values[2]!, values[3]!];
    expect(net).toBe(income - fixed - other);
    expect(income).toBe(100000n);

    // O detalhe do mês: cada valor com lista leva a uma lista com o mesmo total
    const detail = page.getByTestId("fluxo-detalhe");
    const links = await detail
      .getByRole("link")
      .evaluateAll((els) =>
        els
          .filter((e) => e.getAttribute("href")?.startsWith("/lancamentos?"))
          .map(
            (e) =>
              [
                e.getAttribute("href")!,
                e.getAttribute("data-cents")!,
                e.className.includes("text-income"),
              ] as const,
          ),
      );
    expect(links.length).toBeGreaterThan(0);
    for (const [href, cents, isIncome] of links) {
      await openPage(page, href);
      const total = centsOf(
        await page.getByTestId(isIncome ? "total-entradas" : "total-saidas").innerText(),
      );
      expect(total, href).toBe(BigInt(cents));
    }
    await expect(page.getByRole("link", { name: /Fluxo de caixa/ }).first()).toBeVisible();
    await p.close();
  });

  test("Evolução: a categoria de baixo, o orçado do mês e a barra até a lista", async ({
    browser,
  }, testInfo) => {
    const p = await household(browser, testInfo, "evolucao");
    const page = p.page;
    const mercado = p.categories["Mercado"]!;
    await openPage(page, `/orcamento/evolucao?carteira=${p.casa}&categoria=${mercado}&meses=6`);
    await expect(
      page.getByRole("heading", { level: 2, name: "Alimentação › Mercado, mês a mês" }),
    ).toBeVisible();
    await expectNoA11yViolations(page);

    // A barra do mês passado: R$ 300 com orçado de R$ 500 (dentro), e o link até a lista
    const bar = page.locator(`[data-testid=evolucao-grafico] a[data-month="${last}"]`);
    await expect(bar).toHaveAttribute("data-cents", "30000");
    await expect(bar).toHaveAccessibleName(/R\$\s300,00, orçado R\$\s500,00\. Ver os lançamentos/);
    await expectListMatches(page, bar, "saidas");
    await expect(page.getByRole("link", { name: /Evolução · Mercado/ })).toBeVisible();

    // A tabela (alternativa ao gráfico) com os mesmos números
    await openPage(
      page,
      `/orcamento/evolucao?carteira=${p.casa}&categoria=${mercado}&meses=6&ver=tabela`,
    );
    const table = page.getByTestId("evolucao-tabela");
    await expect(table).toContainText("Dentro do orçado");
    await expect(table.locator(`a[data-cents="25000"]`)).toBeVisible();

    // O seletor tem o grupo e a categoria de baixo
    await page.locator("summary", { hasText: "Categoria:" }).filter({ visible: true }).click();
    await page
      .getByRole("link", { name: "Alimentação", exact: true })
      .filter({ visible: true })
      .click();
    await expect(
      page.getByRole("heading", { level: 2, name: "Alimentação, mês a mês" }),
    ).toBeVisible();
    await p.close();
  });
});

test.describe("layout que depende do navegador (Safari: conferir à mão)", () => {
  test("listras do previsto, colunas do orçamento e cartões no celular", async ({
    browser,
  }, testInfo) => {
    const p = await household(browser, testInfo, "layout");
    const page = p.page;
    await openPage(page, `/orcamento?carteira=${p.casa}`);
    await page
      .getByRole("button", { name: `Copiar de ${monthName(last)}` })
      .filter({ visible: true })
      .click();
    await expect(page.getByTestId("orcamento-linhas").locator("li[data-category]")).toHaveCount(2);

    // A listra do previsto é um gradiente repetido (a cor sozinha não diz "previsto")
    const hatch = page.locator(".hatch").first();
    await expect(hatch).toBeAttached();
    expect(await hatch.evaluate((el) => getComputedStyle(el).backgroundImage)).toContain(
      "repeating-linear-gradient",
    );

    // As linhas: 7 colunas alinhadas no computador; cartões de uma coluna e meia no celular
    const row = page.getByTestId("orcamento-linhas").locator("li[data-category] > div").first();
    const columns = await row.evaluate(
      (el) => getComputedStyle(el).gridTemplateColumns.split(" ").length,
    );
    expect(columns).toBe(testInfo.project.name === "celular" ? 2 : 7);
    // Nada sai da tela de lado
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
    await p.close();
  });
});

test.describe("24 meses de seed", () => {
  test.use({ storageState: NO_SESSION });

  // O tempo vale no build de produção (a imagem do M05, PLAYWRIGHT_PRODUCTION=1), que é o que se usa.
  // No pnpm dev, a compilação sob demanda e o React de desenvolvimento dividem a CPU com o navegador:
  // a mesma tela oscilou entre 0,6 e 1,5 s no laboratório e ficou em ~1,05 s no N150, sem mudança
  // de código. Um limite medido lá mede a máquina, não o painel.
  test("o painel abre em menos de 1 s", async ({ page, request }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "o seed é um só: roda num aparelho");
    test.skip(!PRODUCTION_BUILD, "tempo só no build de produção (PLAYWRIGHT_PRODUCTION=1)");
    test.setTimeout(180_000);
    const email = testEmail("seed24", testInfo.project.name);
    const password = "frase longa da visita ao exemplo";
    const { secret } = await createTestUser(request, { email, password, name: "Visita Exemplo" });
    // O seed regrava a Família Exemplo e põe esta conta de teste na Casa (seed/viewer.ts)
    execFileSync("pnpm", ["--filter", "@fintrack/db", "db:seed"], {
      cwd: "../..",
      env: { ...process.env, SEED_VIEWER_EMAIL: email },
      stdio: "pipe",
    });
    await signInThroughUi(page, email, password, secret!);
    await expect(page.getByRole("heading", { level: 1, name: "Início" })).toBeVisible();

    const timed = async (path: string) => {
      await page.goto(path);
      await expect(page.locator("main h1")).toBeVisible();
      return page.evaluate(() => {
        const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming;
        return nav.domContentLoadedEventEnd;
      });
    };
    // Aquece: a primeira visita de cada tela carrega o código dela no servidor
    for (const path of ["/", "/orcamento", "/orcamento/fluxo", "/orcamento/evolucao"])
      await timed(path);
    // A primeira visita de cada tela vem sem o cache das somas (24 meses: outra faixa de datas);
    // as seguintes, com ele. A mediana de três visitas tira o ruído da máquina; as três ficam
    // registradas no relatório.
    for (const path of ["/", "/orcamento", "/orcamento/fluxo", "/orcamento/evolucao?meses=24"]) {
      const runs = [await timed(path), await timed(path), await timed(path)];
      const median = runs.toSorted((a, b) => a - b)[1]!;
      testInfo.annotations.push({
        type: "tempo",
        description: `${path}: ${runs.map((ms) => Math.round(ms)).join(", ")} ms (mediana ${Math.round(median)})`,
      });
      expect(median, path).toBeLessThan(1000);
    }
  });
});
