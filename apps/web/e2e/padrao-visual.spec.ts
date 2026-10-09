import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { NO_SESSION, openPage } from "./helpers";

// M07.2: o padrão Elétrico em todas as telas (ADR-008, adendo).

test("o Início mostra o mesmo saldo do mês que a lista de lançamentos", async ({ page }) => {
  await openPage(page, "/lancamentos");
  const saldoLista = (await page.getByTestId("total-saldo").innerText()).replace(/\s+/g, " ");
  await openPage(page, "/");
  await expect(page.getByRole("region", { name: /Saldo de/ })).toBeVisible();
  const saldoInicio = (await page.getByTestId("inicio-saldo").innerText()).replace(/\s+/g, " ");
  // O texto da lista inclui o rótulo "Saldo do período"; o valor tem de ser o mesmo
  expect(saldoLista).toContain(saldoInicio.trim());
  await expect(page.getByRole("navigation", { name: "Atalhos" }).getByRole("link")).toHaveCount(4);
});

test("os chips de período trocam as datas na URL e marcam o escolhido", async ({ page }) => {
  await openPage(page, "/lancamentos");
  const periodo = page.getByRole("navigation", { name: "Período" });
  await expect(periodo.getByRole("link", { name: "Este mês" })).toHaveAttribute(
    "aria-current",
    "true",
  );
  await periodo.getByRole("link", { name: "Mês passado" }).click();
  await expect(page).toHaveURL(/de=\d{4}-\d{2}-01&ate=\d{4}-\d{2}-(28|29|30|31)/);
  await expect(periodo.getByRole("link", { name: "Mês passado" })).toHaveAttribute(
    "aria-current",
    "true",
  );
  await expect(periodo.getByRole("link", { name: "Este mês" })).not.toHaveAttribute("aria-current");
});

test("a linha do lançamento não repete texto: no desktop os detalhes viram colunas", async ({
  page,
  isMobile,
}) => {
  await openPage(page, "/lancamentos");
  const linha = page.getByRole("listitem").filter({ hasText: "Padaria do Bairro" }).first();
  await expect(linha).toBeVisible();
  // a categoria aparece uma vez só, visível, nos dois aparelhos
  await expect(linha.getByText("Mercado", { exact: true })).toHaveCount(1);
  await expect(linha.getByText("Mercado", { exact: true })).toBeVisible();
  const colunas = await linha.evaluate(
    (el) => getComputedStyle(el).gridTemplateColumns.split(" ").length,
  );
  expect(colunas).toBe(isMobile ? 4 : 7);
});

test.describe("telas de entrada", () => {
  test.use({ storageState: NO_SESSION });

  test("o painel do app aparece ao lado do formulário só na tela larga", async ({
    page,
    isMobile,
  }) => {
    await openPage(page, "/entrar");
    const painel = page.getByRole("complementary", { name: "Sobre o FinTrack" });
    if (isMobile) await expect(painel).toBeHidden();
    else await expect(painel).toBeVisible();
    await expect(page.getByRole("heading", { level: 1, name: "Entrar no FinTrack" })).toBeVisible();
  });
});

test("o menu lateral de vidro recolhe até ficarem só os ícones e lembra a escolha", async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, "no celular não há menu lateral; a navegação é a barra inferior");
  await openPage(page, "/lancamentos");
  const menu = page.getByRole("complementary", { name: "Menu lateral" });
  const largura = () => menu.evaluate((e) => e.getBoundingClientRect().width);
  expect(await largura()).toBeGreaterThan(200);

  await menu.getByRole("button", { name: "Recolher menu" }).click();
  await expect.poll(largura).toBeLessThan(100);

  // recolhido, o link continua com nome para o leitor de tela; o texto vira dica no mouse
  const carteiras = menu.getByRole("link", { name: "Carteiras" });
  const dica = carteiras.getByText("Carteiras", { exact: true });
  await expect(dica).toHaveCSS("opacity", "0");
  await carteiras.hover();
  await expect(dica).toHaveCSS("opacity", "1");
  const axe = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(axe.violations.map((v) => v.id)).toEqual([]);

  // a escolha fica num cookie: o servidor já desenha recolhido, sem o menu pular
  await page.reload();
  expect(await largura()).toBeLessThan(100);
  await menu.getByRole("button", { name: "Expandir menu" }).click();
  await expect.poll(largura).toBeGreaterThan(200);
  await expect(menu.getByRole("button", { name: "Recolher menu" })).toBeVisible();
});
