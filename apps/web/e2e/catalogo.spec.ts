import { expect, test, type Locator, type Page } from "@playwright/test";

// Relógio controlado: dá para pular os segundos do aviso sem esperar de verdade
async function openCatalog(page: Page): Promise<void> {
  await page.clock.install();
  await page.goto("/dev/ui");
  await expect(page.locator("html")).toHaveAttribute("data-hydrated", "true");
}

function deleteButton(page: Page, name: string): Locator {
  return page.getByRole("button", { name: `Excluir ${name} (exemplo)` });
}

function toastFor(page: Page, name: string): Locator {
  return page.locator("[data-sonner-toast]").filter({ hasText: `"${name} (exemplo)" excluído` });
}

// Aperta Tab até o foco chegar no alvo, como faria quem só usa o teclado
async function tabUntil(page: Page, target: Locator, maxPresses = 10): Promise<void> {
  for (let i = 0; i < maxPresses; i++) {
    await page.keyboard.press("Tab");
    if (await target.evaluate((el) => el === document.activeElement)) return;
  }
  throw new Error(`O foco não chegou ao alvo depois de ${maxPresses} Tabs`);
}

test.describe("Excluir com desfazer, só com teclado", () => {
  test("depois de excluir, o foco vai para o próximo botão de excluir", async ({ page }) => {
    await openCatalog(page);

    await deleteButton(page, "Mercado").focus();
    await page.keyboard.press("Enter");
    await expect(deleteButton(page, "Salário")).toBeFocused();

    await page.keyboard.press("Enter");
    await expect(deleteButton(page, "Farmácia")).toBeFocused();
  });

  test("ao excluir o último da lista, o foco vai para o novo último", async ({ page }) => {
    await openCatalog(page);

    await deleteButton(page, "Farmácia").focus();
    await page.keyboard.press("Enter");
    await expect(deleteButton(page, "Salário")).toBeFocused();
  });

  test("com a lista vazia, o foco vai para o título da seção", async ({ page }) => {
    await openCatalog(page);

    await deleteButton(page, "Mercado").focus();
    for (let i = 0; i < 3; i++) await page.keyboard.press("Enter");
    await expect(page.getByRole("heading", { name: "Excluir com desfazer" })).toBeFocused();
  });

  test("o aviso dura 10 segundos e ensina o atalho Alt+T", async ({ page }) => {
    await openCatalog(page);

    await deleteButton(page, "Mercado").focus();
    await page.keyboard.press("Enter");
    const toast = toastFor(page, "Mercado");
    await expect(toast).toContainText("Alt+T");

    await page.clock.fastForward(8_000);
    await expect(toast).toBeVisible();

    await page.clock.fastForward(3_000);
    await expect(toast).toBeHidden();
  });

  test("Alt+T pausa o aviso, e desfazer devolve o foco ao item restaurado", async ({ page }) => {
    await openCatalog(page);

    await deleteButton(page, "Mercado").focus();
    await page.keyboard.press("Enter");
    const toast = toastFor(page, "Mercado");

    await page.keyboard.press("Alt+t");
    await page.clock.fastForward(20_000);
    await expect(toast).toBeVisible();

    await tabUntil(page, toast.getByRole("button", { name: "Desfazer" }));
    await page.keyboard.press("Enter");

    await expect(deleteButton(page, "Mercado")).toBeFocused();
  });
});

test("os avisos têm nomes acessíveis em português", async ({ page }) => {
  await openCatalog(page);

  await deleteButton(page, "Mercado").focus();
  await page.keyboard.press("Enter");
  const toast = toastFor(page, "Mercado");

  await expect(toast.getByRole("button", { name: "Fechar aviso" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Notificações alt+T" })).toBeAttached();
});
