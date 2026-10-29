// O site como quem visita: as três páginas abrem sem erro e sem nada de fora, passam no axe nos
// dois temas, e o mapa do fluxo e o "quem usa" respondem ao clique e ao endereço.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const PAGES = [
  { path: "./", heading: "Como o FinTrack funciona por dentro" },
  { path: "fluxo.html", heading: "Nova conta" },
  { path: "quem-usa.html", heading: "Quem usa" },
];

/** Abre a página guardando erros do console e qualquer pedido para fora do próprio site. */
async function open(page: Page, path: string) {
  const problems: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") problems.push(`console: ${m.text()}`);
  });
  page.on("pageerror", (e) => problems.push(`erro: ${e.message}`));
  page.on("request", (r) => {
    if (!r.url().startsWith("http://127.0.0.1:4173/"))
      problems.push(`pedido para fora: ${r.url()}`);
  });
  await page.goto(path);
  return problems;
}

for (const scheme of ["light", "dark"] as const) {
  test.describe(`tema ${scheme === "light" ? "claro" : "escuro"}`, () => {
    test.use({ colorScheme: scheme });
    for (const { path, heading } of PAGES) {
      test(`${path} abre, sem erro, sem nada de fora, e passa no axe`, async ({ page }) => {
        const problems = await open(page, path);
        await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
        const results = await new AxeBuilder({ page }).withTags(WCAG).analyze();
        expect(results.violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
        // A página não rola para o lado (o celular inclusive)
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - window.innerWidth,
        );
        expect(overflow).toBeLessThanOrEqual(0);
        expect(problems).toEqual([]);
      });
    }
  });
}

test("a visão geral mostra os três níveis do C4 como imagem, com o texto do diagrama", async ({
  page,
}) => {
  await open(page, "./");
  for (const n of [1, 2, 3]) {
    const img = page.locator(`img[src="c4-nivel-${n}.svg"]`);
    await expect(img).toHaveAttribute("alt", /Diagrama C4/);
    // A imagem carregou de verdade, no tamanho do desenho (o build grava a largura do viewBox)
    await expect
      .poll(() => img.evaluate((el) => (el as HTMLImageElement).naturalWidth))
      .toBeGreaterThan(600);
  }
  await expect(page.locator("details pre").first()).toContainText("flowchart");
});

test("a CSP fica na própria página e não deixa nada inline", async ({ page }) => {
  await open(page, "fluxo.html");
  const csp = await page
    .locator('meta[http-equiv="Content-Security-Policy"]')
    .getAttribute("content");
  expect(csp).toContain("script-src 'self'");
  expect(csp).not.toContain("unsafe-inline");
});

test("no mapa do fluxo, escolher uma caixa mostra o detalhe dela e vai para o endereço", async ({
  page,
}) => {
  await open(page, "fluxo.html#tela=%2Fajustes%2Fcontas%2Fnova");
  const detail = page.getByRole("region", { name: "Detalhe da caixa escolhida" });
  // Sem caixa no endereço, a primeira ação da tela vem escolhida
  await expect(detail.getByRole("heading", { name: "createAccountAction" })).toBeVisible();
  await expect(detail).toContainText("crachá manage_accounts");
  await expect(detail).toContainText("walletId");
  await page.getByRole("link", { name: /^carregamento getNewAccountPage/ }).click();
  await expect(detail.getByRole("heading", { name: "getNewAccountPage" })).toBeVisible();
  expect(decodeURIComponent(page.url())).toContain(
    "no=apps/web/src/features/accounts/server/queries.ts#getNewAccountPage",
  );
  // Uma função do banco também é caixa, com as tabelas dela
  await page.getByRole("link", { name: /^função listWalletAccounts/ }).click();
  await expect(detail.getByRole("heading", { name: "listWalletAccounts" })).toBeVisible();
  await expect(detail).toContainText("FinancialAccount");
});

test("o endereço guarda a tela: voltar no navegador volta para a anterior", async ({ page }) => {
  await open(page, "fluxo.html#tela=%2Fajustes%2Fcontas%2Fnova");
  await expect(page.getByRole("heading", { level: 1, name: "Nova conta" })).toBeVisible();
  await page.getByRole("link", { name: "/ajustes/contas", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Contas e cartões" })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole("heading", { level: 1, name: "Nova conta" })).toBeVisible();
});

test("a busca filtra as telas pelo nome, pela ação ou pela tabela", async ({ page, isMobile }) => {
  test.skip(isMobile, "no celular a lista vira o seletor");
  await open(page, "fluxo.html");
  const telas = page.getByRole("navigation", { name: "Telas" });
  await page.getByLabel("Buscar tela, ação ou tabela").fill("FinancialAccount");
  await expect(page.getByRole("status")).toContainText("telas");
  await expect(telas.getByRole("link", { name: "Nova conta" }).first()).toBeVisible();
  await page.getByLabel("Buscar tela, ação ou tabela").fill("primeiro acesso");
  await expect(telas.getByRole("link")).toHaveCount(1);
});

test("no celular, a tela se escolhe pelo seletor", async ({ page, isMobile }) => {
  test.skip(!isMobile, "só no celular");
  await open(page, "fluxo.html");
  await page.getByLabel("Tela", { exact: true }).selectOption({ label: "Entrar" });
  await expect(page.getByRole("heading", { level: 1, name: "Entrar" })).toBeVisible();
  await expect(page.getByText("signIn.email")).toBeVisible();
});

test("quem usa: o serviço, a tabela e a fila levam às telas que chegam até eles", async ({
  page,
}) => {
  await open(page, "quem-usa.html#servico=pluggy");
  const telas = page
    .getByRole("region", { name: /^Telas/ })
    .or(page.locator("section.coluna").first());
  await expect(page.locator(".escolhido")).toContainText("Meu Pluggy");
  await expect(telas).toContainText("Conectar o Meu Pluggy");
  await page.getByRole("link", { name: "Tabela" }).click();
  await page.getByLabel("Qual").selectOption("FinancialAccount");
  await expect(page.locator(".escolhido")).toContainText("financial_account");
  await expect(page.locator("section.coluna").first()).toContainText("Nova conta");
  await page.getByRole("link", { name: "Fila" }).click();
  await page.getByLabel("Qual").selectOption("bank-sync");
  await expect(page.locator("section.coluna").nth(1)).toContainText("requestSyncAction");
});
