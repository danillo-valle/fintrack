import { expect, test } from "@playwright/test";
import { openPage } from "./helpers";

test("o tema escolhido é aplicado e sobrevive a um recarregamento", async ({ page }) => {
  await openPage(page, "/ajustes");
  const main = page.getByRole("main");
  const toggle = main.getByRole("button", { name: /^Tema:/ });

  await expect(toggle).toHaveAccessibleName(/Tema: Sistema/);
  await toggle.click(); // Sistema → Claro
  await toggle.click(); // Claro → Escuro
  await expect(toggle).toHaveAccessibleName(/Tema: Escuro/);
  await expect(page.locator("html")).toHaveClass(/dark/);

  await page.reload();
  await expect(page.locator("html[data-hydrated]")).toBeAttached();
  await expect(page.locator("html")).toHaveClass(/dark/);
});
