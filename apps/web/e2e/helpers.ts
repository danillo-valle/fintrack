import { expect, type Page } from "@playwright/test";

/** Abre a página e espera o React terminar de carregar, para nada do que for digitado se perder. */
export async function openPage(page: Page, path: string) {
  const response = await page.goto(path);
  await expect(page.locator("html[data-hydrated]")).toBeAttached();
  return response;
}

/** O Intl separa "R$" do número com um espaço não separável (U+00A0). */
export const brl = (text: string) => text.replace(" ", "\u00a0");

/** Todas as páginas do app. Os testes de acessibilidade e de foco passam por cada uma. */
export const PAGES = [
  "/",
  "/lancamentos",
  "/lancamentos/novo",
  "/orcamento",
  "/carteiras",
  "/ajustes",
  "/dev/ui",
];
