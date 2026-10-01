import { expect, test } from "@playwright/test";

test("desfazer o lançamento pelo teclado devolve o foco ao campo Valor", async ({ page }) => {
  await page.clock.install();
  await page.goto("/lancamentos/novo");
  await expect(page.locator("html")).toHaveAttribute("data-hydrated", "true");

  const amount = page.getByLabel("Valor", { exact: true });
  await amount.focus();
  await page.keyboard.type("4235");
  await page.keyboard.press("Tab");
  await page.keyboard.type("Mercado");
  await page.keyboard.press("Enter");

  const toast = page.locator("[data-sonner-toast]").filter({ hasText: "R$ 42,35 registrada" });
  await expect(toast).toContainText("Alt+T");

  // Antes durava 4 segundos; com o aviso de desfazer precisa durar 10
  await page.clock.fastForward(8_000);
  await expect(toast).toBeVisible();

  await page.keyboard.press("Alt+t");
  await page.clock.fastForward(20_000);
  await expect(toast).toBeVisible();

  const undo = toast.getByRole("button", { name: "Desfazer" });
  for (let i = 0; i < 10; i++) {
    await page.keyboard.press("Tab");
    if (await undo.evaluate((el) => el === document.activeElement)) break;
  }
  await expect(undo).toBeFocused();
  await page.keyboard.press("Enter");

  await expect(amount).toBeFocused();
  // \s: o Intl separa "R$" do número com um espaço não separável
  await expect(amount).toHaveValue(/^R\$\s42,35$/);
});
