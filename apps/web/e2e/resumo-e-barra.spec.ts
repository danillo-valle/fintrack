import { expect, test } from "@playwright/test";
import { openPage } from "./helpers";

// M07.3: o desenho C.2 do canvas (opção B). O resumo compacto, a barra de filtros e ações, o
// menu lateral só de navegação e o modal do novo lançamento sem barra de rolagem.

test("o resumo mostra saldo, entradas e saídas numa faixa", async ({ page }) => {
  await openPage(page, "/lancamentos");
  const resumo = page.getByRole("region", { name: "Totais do filtro" });
  await expect(resumo.getByTestId("total-saldo")).toContainText("Saldo do período");
  await expect(resumo.getByTestId("total-entradas")).toContainText("Entradas");
  await expect(resumo.getByTestId("total-saidas")).toContainText("Saídas");
  // Uma faixa baixa: o resumo inteiro cabe em 240 px de altura nos dois aparelhos
  const altura = await resumo.evaluate((el) => el.getBoundingClientRect().height);
  expect(altura).toBeLessThan(240);
});

test("Novo lançamento fica no cabeçalho da página, não no menu lateral", async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, "no celular não há menu lateral; o botão flutuante faz esse papel");
  await openPage(page, "/lancamentos");
  const menu = page.getByRole("complementary", { name: "Menu lateral" });
  await expect(menu.getByRole("link", { name: "Novo lançamento" })).toHaveCount(0);
  await expect(page.getByRole("main").getByRole("link", { name: "Novo lançamento" })).toBeVisible();
});

test("o painel de filtros abre pelo botão e fecha com Esc, devolvendo o foco", async ({
  page,
  isMobile,
}) => {
  await openPage(page, "/lancamentos");
  // No celular, o mesmo botão também guarda as ações (Transferência, Recorrências, CSV)
  const botao = page.getByRole("button", {
    name: isMobile ? "Filtros e mais ações" : "Filtros",
    exact: true,
  });
  await expect(botao).toHaveAttribute("aria-expanded", "false");
  await botao.click();
  await expect(botao).toHaveAttribute("aria-expanded", "true");
  const painel = page.getByRole("region", { name: "Filtros" });
  await expect(painel.getByRole("search", { name: "Filtrar lançamentos" })).toBeVisible();
  if (isMobile) {
    await expect(painel.getByRole("link", { name: "Transferência" })).toBeVisible();
  } else {
    // No computador as ações ficam na barra, ao lado dos chips
    const acoes = page.getByRole("navigation", { name: "Mais ações de lançamento" });
    await expect(acoes.getByRole("link", { name: "Transferência" })).toBeVisible();
  }
  await painel.getByLabel("Ambiente").focus();
  await page.keyboard.press("Escape");
  await expect(painel).toBeHidden();
  await expect(botao).toBeFocused();
});

test("o modal do novo lançamento cabe na tela, e o subtítulo segue o ambiente", async ({
  page,
  isMobile,
}) => {
  await openPage(page, "/lancamentos");
  await page.getByRole("link", { name: "Novo lançamento" }).first().click();
  const modal = page.getByRole("dialog", { name: "Novo lançamento" });
  await expect(modal).toBeVisible();
  // O botão de salvar fica sempre à vista, no rodapé
  const salvar = modal.getByRole("button", { name: "Salvar despesa" });
  await expect(salvar).toBeInViewport();
  if (!isMobile) {
    // No computador (1280 × 720), nada de barra de rolagem dentro do modal, em nenhum tipo de
    // despesa (M07.4): parcelada e fixa têm uma linha a mais, e a variante "compact" aperta os
    // blocos em tela baixa para elas caberem também
    for (const tipo of ["Variável", "Parcelada", "Fixa"]) {
      await modal.getByText(tipo, { exact: true }).click();
      const sobra = await modal.evaluate((dialog) => {
        const meio = dialog.children[1] as HTMLElement;
        return meio.scrollHeight - meio.clientHeight;
      });
      expect(sobra, tipo).toBeLessThanOrEqual(0);
    }
    await modal.getByText("Variável", { exact: true }).click();
    // O meio cresce a partir do conteúdo (flex-basis auto). Com base 0 % (flex-1), o Safari
    // calculava o meio a partir de zero e o formulário sumia; o Chromium dos testes não mostra isso,
    // então a regra é conferida no estilo calculado.
    const base = await modal.evaluate(
      (dialog) => getComputedStyle(dialog.children[1] as HTMLElement).flexBasis,
    );
    expect(base).toBe("auto");
  }
  const ambiente = modal.getByLabel("Ambiente");
  const nome = await ambiente.evaluate((s: HTMLSelectElement) => s.selectedOptions[0]!.text);
  await expect(modal.getByText(`No ambiente ${nome}`)).toBeVisible();
});

test("em tela bem baixa, só o meio do modal rola, e o Salvar continua à vista", async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, "no celular o painel ocupa a tela toda");
  await page.setViewportSize({ width: 1280, height: 560 });
  await openPage(page, "/lancamentos");
  await page.getByRole("link", { name: "Novo lançamento" }).first().click();
  const modal = page.getByRole("dialog", { name: "Novo lançamento" });
  await expect(modal).toBeVisible();
  const meio = await modal.evaluate((dialog) => {
    const m = dialog.children[1] as HTMLElement;
    return { altura: m.clientHeight, sobra: m.scrollHeight - m.clientHeight };
  });
  expect(meio.altura).toBeGreaterThan(200); // o formulário aparece, não some
  expect(meio.sobra).toBeGreaterThan(0); // e rola, porque não cabe
  await expect(modal.getByRole("button", { name: "Salvar despesa" })).toBeInViewport();
});
