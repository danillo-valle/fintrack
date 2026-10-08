import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { openPage } from "./helpers";

// M07.1 (Visual C, ADR-008): o modal do novo lançamento e a moldura de vidro.

async function openModal(page: import("@playwright/test").Page, from = "/lancamentos") {
  await openPage(page, from);
  await page.getByRole("link", { name: "Novo lançamento" }).first().click();
  const modal = page.getByRole("dialog", { name: "Novo lançamento" });
  await expect(modal).toBeVisible();
  return modal;
}

test("o modal fecha com Esc e com o botão Fechar, e a URL volta junto", async ({ page }) => {
  let modal = await openModal(page);
  await page.keyboard.press("Escape");
  await expect(modal).toBeHidden();
  await expect(page).toHaveURL("/lancamentos");

  modal = await openModal(page);
  await modal.getByRole("button", { name: "Fechar" }).click();
  await expect(modal).toBeHidden();
  await expect(page).toHaveURL("/lancamentos");
  await expect(page.getByRole("heading", { level: 1, name: "Lançamentos" })).toBeVisible();
});

test("o foco fica preso no modal: Tab não sai para a página atrás", async ({ page }) => {
  const modal = await openModal(page);
  for (let i = 0; i < 25; i++) {
    await page.keyboard.press("Tab");
    const inside = await page.evaluate(() => {
      const dialog = document.querySelector("dialog[open]");
      const active = document.activeElement;
      // o foco pode passar pela barra do navegador (body); nunca por um elemento da página
      return !active || active === document.body || Boolean(dialog?.contains(active));
    });
    expect(inside, `Tab nº ${i + 1}`).toBe(true);
  }
  await expect(modal).toBeVisible();
});

test("abrir /lancamentos/novo direto mostra a página inteira, sem modal", async ({ page }) => {
  await openPage(page, "/lancamentos/novo");
  await expect(page.getByRole("heading", { level: 1, name: "Novo lançamento" })).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("os ids do modal não repetem os da página atrás (editar + novo)", async ({ page }) => {
  await openPage(page, "/lancamentos");
  // abre um lançamento existente (a página de edição tem o mesmo formulário) e, dali, o modal
  await page
    .getByRole("link", { name: /Padaria do Bairro/ })
    .first()
    .click();
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await page.getByRole("link", { name: "Novo lançamento" }).first().click();
  await expect(page.getByRole("dialog", { name: "Novo lançamento" })).toBeVisible();
  const duplicated = await page.evaluate(() => {
    const seen = new Map<string, number>();
    for (const el of document.querySelectorAll("[id]")) seen.set(el.id, (seen.get(el.id) ?? 0) + 1);
    return [...seen].filter(([, n]) => n > 1).map(([id]) => id);
  });
  expect(duplicated).toEqual([]);
});

for (const scheme of ["light", "dark"] as const) {
  test.describe(`tema ${scheme === "light" ? "claro" : "escuro"}`, () => {
    test.use({ colorScheme: scheme });

    test("o modal aberto passa no axe (WCAG 2.2 AA)", async ({ page }) => {
      await openModal(page);
      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
        .analyze();
      expect(
        results.violations.map((v) => ({ regra: v.id, onde: v.nodes.map((n) => n.target) })),
      ).toEqual([]);
    });
  });
}

test("a moldura do celular é de vidro (desfoque) e o conteúdo é sólido", async ({
  page,
  isMobile,
}) => {
  test.skip(!isMobile, "a moldura de vidro é a do celular (cabeçalho e barra inferior)");
  await openPage(page, "/lancamentos");
  const nav = page.locator('nav[aria-label="Principal"]:visible');
  const filter = await nav.evaluate((el) => getComputedStyle(el).backdropFilter);
  expect(filter).toContain("blur");
  const saldo = page.getByTestId("total-saldo");
  expect(await saldo.evaluate((el) => getComputedStyle(el).backdropFilter)).toBe("none");
});
