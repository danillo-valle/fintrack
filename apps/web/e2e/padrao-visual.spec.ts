import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { NO_SESSION, openPage } from "./helpers";

// M07.2: o padrão Elétrico em todas as telas (ADR-008, adendo).

test("o Início mostra o mesmo gasto do mês que a lista de lançamentos", async ({ page }) => {
  // M13.3a: as "Saídas" do resultado do mês levam ao recorte em duas partes (contas e cartões),
  // que soma o mesmo valor (painel.spec.ts confere todos os números)
  await openPage(page, "/");
  await expect(page.getByRole("region", { name: /^Resultado de / })).toBeVisible();
  const link = page.getByTestId("resultado-saidas").getByRole("link");
  const cents = BigInt((await link.getAttribute("data-cents")) ?? "x");
  await link.click();
  await expect(page).toHaveURL(/\/lancamentos\?/);
  const text = (await page.getByTestId("recorte-total").innerText()).replace(/\s+/g, " ");
  const [, reais, centavos] = text.match(/R\$ ?([\d.]+),(\d{2})/) ?? [];
  expect(BigInt(`${reais?.replaceAll(".", "")}${centavos}`)).toBe(cents);
});

test("o Período: os atalhos marcam os meses na URL e o combo mostra o escolhido", async ({
  page,
}) => {
  await openPage(page, "/lancamentos");
  const combo = page.getByRole("button", { name: /^Período/ });
  await combo.click();
  const panel = page.getByRole("region", { name: "Período" });
  await expect(panel.getByRole("link", { name: "Este mês" })).toHaveAttribute(
    "aria-current",
    "true",
  );
  await panel.getByRole("link", { name: "Mês passado" }).click();
  await expect(page).toHaveURL(/mes=\d{4}-\d{2}/);
  await expect(page).not.toHaveURL(/de=/);
  await page.getByRole("button", { name: /^Período/ }).click();
  await expect(
    page.getByRole("region", { name: "Período" }).getByRole("link", { name: "Mês passado" }),
  ).toHaveAttribute("aria-current", "true");
});

test("a linha do lançamento não repete texto: no desktop os detalhes viram colunas", async ({
  page,
  isMobile,
}) => {
  await openPage(page, "/lancamentos?q=Padaria");
  const linha = page.getByRole("listitem").filter({ hasText: "Padaria do Bairro" }).first();
  await expect(linha).toBeVisible();
  // a categoria aparece uma vez só, visível, nos dois aparelhos
  await expect(linha.getByText("Mercado", { exact: true })).toHaveCount(1);
  await expect(linha.getByText("Mercado", { exact: true })).toBeVisible();
  const colunas = await linha.evaluate(
    (el) => getComputedStyle(el).gridTemplateColumns.split(" ").length,
  );
  expect(colunas).toBe(isMobile ? 3 : 7);
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
