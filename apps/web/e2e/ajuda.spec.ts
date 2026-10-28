// A Ajuda (M12.3a, ADR-022, pranchas J-Ajuda, J-AjudaDaTela, J-CelAjuda e J-PrimeiroAcesso):
//
//   1. O "?" ao lado do título de uma tela abre a ajuda dela em modal; "Fechar" volta para a
//      tela; "Abrir na Ajuda" leva à página inteira.
//   2. A busca (formulário GET, ?q=) acha pelos termos sem acento e marca o trecho.
//   3. Todo artigo abre (com o título certo na aba) e o índice leva a todos.
//   4. O primeiro acesso é público e está ligado de Entrar e de Criar conta.
import { expect } from "@playwright/test";
import { HELP_ARTICLES } from "../src/features/help/content";
import {
  clickAndWait,
  expectNoA11yViolations,
  NO_SESSION,
  openPage,
  pageData,
  test,
  waitForReady,
} from "./helpers";

test("o ? de uma tela abre a ajuda dela em modal, e a página inteira", async ({ page }) => {
  await openPage(page, "/ajustes/contas");
  const help = page.getByRole("link", { name: "Ajuda desta tela" });
  await clickAndWait(help, pageData("/ajuda/contas-e-cartoes"));
  const dialog = page.getByRole("dialog", { name: "Contas e cartões" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("só os 4 últimos dígitos");
  await expect(dialog.getByRole("heading", { name: "Adicionar um cartão" })).toBeVisible();
  await expectNoA11yViolations(page);

  // Fechar (o X do modal) volta para a tela de baixo
  await dialog.getByRole("button", { name: "Fechar" }).click();
  await expect(dialog).toBeHidden();
  await expect(page).toHaveURL(/\/ajustes\/contas$/);

  // "Abrir na Ajuda" é a página inteira do artigo
  await clickAndWait(help, pageData("/ajuda/contas-e-cartoes"));
  await page.getByRole("dialog").getByRole("link", { name: "Abrir na Ajuda" }).click();
  await page.waitForURL(/\/ajuda\/contas-e-cartoes$/);
  await waitForReady(page);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Contas e cartões");
  await expect(page).toHaveTitle("Ajuda: Contas e cartões · FinTrack");
  await expect(page.getByRole("link", { name: "Ir para a tela" })).toHaveAttribute(
    "href",
    "/ajustes/contas",
  );
});

test("a busca acha sem acento e marca a palavra no trecho", async ({ page }) => {
  await openPage(page, "/ajuda");
  await page.getByRole("searchbox", { name: "Buscar na ajuda" }).fill("FATÚRA");
  await page.getByRole("button", { name: "Buscar" }).click();
  await page.waitForURL(/\/ajuda\?q=FAT/);
  await waitForReady(page);
  const results = page.getByTestId("ajuda-resultados");
  await expect(page.getByRole("status").filter({ hasText: /resultados para/ })).toBeVisible();
  await expect(
    results.getByRole("link", { name: /Importar extrato ou fatura em PDF/ }),
  ).toBeVisible();
  await expect(results.locator("mark").first()).toHaveText(/fatura/i);

  // Nada encontrado: a frase diz o que fazer
  await openPage(page, "/ajuda?q=xyzzy");
  await expect(page.getByRole("status")).toContainText("Nada encontrado para “xyzzy”");
});

test("todo artigo abre com o título certo, e o índice leva a todos", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "conteúdo: um aparelho basta");
  test.slow(); // um artigo por vez
  await openPage(page, "/ajuda");
  for (const article of HELP_ARTICLES) {
    await expect(page.getByRole("link", { name: article.title, exact: true })).toHaveAttribute(
      "href",
      `/ajuda/${article.slug}`,
    );
  }
  for (const article of HELP_ARTICLES) {
    await openPage(page, `/ajuda/${article.slug}`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(article.title);
    await expect(page).toHaveTitle(`Ajuda: ${article.title} · FinTrack`);
  }
  // Endereço que não é de um artigo: a página 404 de sempre
  await openPage(page, "/ajuda/nao-existe");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Página não encontrada");
});

test.describe("sem entrar", () => {
  test.use({ storageState: NO_SESSION });

  test("o primeiro acesso é público e ligado de Entrar e de Criar conta", async ({ page }) => {
    for (const from of ["/entrar", "/cadastro"]) {
      await openPage(page, from);
      await page.getByRole("link", { name: "Primeira vez? Veja o passo a passo" }).click();
      await page.waitForURL("/primeiro-acesso");
      await waitForReady(page);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText("Primeiro acesso");
      await expect(page.getByText("Ligar o 2FA.")).toBeVisible();
    }
    // O resto da Ajuda continua só para quem entrou
    await page.goto("/ajuda/contas-e-cartoes");
    await expect(page).toHaveURL(/\/entrar\?next=%2Fajuda%2Fcontas-e-cartoes/);
  });
});
