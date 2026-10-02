import { expect, test } from "@playwright/test";
import { openPage } from "./helpers";

const SECTIONS = [
  { path: "/", label: "Início" },
  { path: "/lancamentos", label: "Lançamentos" },
  { path: "/orcamento", label: "Orçamento" },
  { path: "/carteiras", label: "Carteiras" },
  { path: "/ajustes", label: "Ajustes" },
];

test("navega por todas as seções pelo menu principal", async ({ page }) => {
  await openPage(page, "/");
  // Só um dos dois menus está visível por vez; o Playwright ignora o que está escondido
  const nav = page.getByRole("navigation", { name: "Principal" });

  for (const { path, label } of SECTIONS) {
    await nav.getByRole("link", { name: label }).click();
    await expect(page).toHaveURL(path);
    await expect(page.getByRole("heading", { level: 1, name: label })).toBeVisible();
    await expect(nav.getByRole("link", { name: label })).toHaveAttribute("aria-current", "page");
    // O título da aba segue o h1 (WCAG 2.4.2): é o que o leitor de tela anuncia ao trocar de página
    await expect(page).toHaveTitle(`${label} · FinTrack`);
  }
});

test("o primeiro Tab oferece pular direto para o conteúdo", async ({ page }) => {
  await openPage(page, "/lancamentos");
  await page.keyboard.press("Tab");
  const skip = page.getByRole("link", { name: "Pular para o conteúdo" });
  await expect(skip).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("main#conteudo")).toBeFocused();
});

test("Novo lançamento está sempre a um toque", async ({ page }) => {
  await openPage(page, "/orcamento");
  await page.getByRole("link", { name: "Novo lançamento" }).first().click();
  await expect(page).toHaveURL("/lancamentos/novo");
  await expect(page.getByRole("heading", { level: 1, name: "Novo lançamento" })).toBeVisible();
});

test("endereço inexistente mostra a página 404 em português", async ({ page }) => {
  const response = await openPage(page, "/nao-existe");
  expect(response?.status()).toBe(404);
  await expect(page.getByText("Esta página não existe")).toBeVisible();
});
