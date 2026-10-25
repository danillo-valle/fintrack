import { expect, test } from "@playwright/test";
import { openCatalog } from "./helpers";

test.beforeEach(async ({ page }) => {
  await openCatalog(page);
});

test("excluir com desfazer funciona só com o teclado", async ({ page }) => {
  const excluir = page.getByRole("button", { name: "Excluir Mercado (exemplo)" });
  await excluir.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByText("Mercado (exemplo)", { exact: true })).toHaveCount(0);

  // O foco não se perde: vai para a lixeira do próximo item
  await expect(page.getByRole("button", { name: "Excluir Salário (exemplo)" })).toBeFocused();

  // Alt+T leva o foco à região dos avisos; dali, o Tab chega ao Desfazer
  await page.keyboard.press("Alt+T");
  const desfazer = page.getByRole("button", { name: "Desfazer" });
  for (let i = 0; i < 5 && !(await desfazer.evaluate((el) => el === document.activeElement)); i++) {
    await page.keyboard.press("Tab");
  }
  await expect(desfazer).toBeFocused();
  await page.keyboard.press("Enter");

  await expect(page.getByText("Mercado (exemplo)", { exact: true })).toBeVisible();
  // Ao desfazer, o foco volta para a lixeira do item restaurado
  await expect(excluir).toBeFocused();
});

test("excluir o último item leva o foco ao aviso de lista vazia", async ({ page }) => {
  for (const nome of ["Mercado", "Salário", "Farmácia"]) {
    await page.getByRole("button", { name: `Excluir ${nome} (exemplo)` }).click();
  }
  await expect(page.getByText(/^Lista vazia/)).toBeFocused();
});

test("o aviso fala português e dá tempo para chegar ao Desfazer", async ({ page }) => {
  await page.getByRole("button", { name: "Excluir Mercado (exemplo)" }).click();
  await expect(page.getByRole("region", { name: "Avisos (Alt+T)" })).toBeAttached();
  await expect(page.getByRole("button", { name: "Fechar aviso" })).toBeAttached();
  await expect(page.getByText("Alt+T leva aos avisos e pausa o tempo.")).toBeVisible();

  // Sem interação, o aviso ainda está na tela depois de 6 s (o padrão do Sonner seria 4 s)
  await page.mouse.move(0, 0);
  await page.waitForTimeout(6_000);
  await expect(page.getByRole("button", { name: "Desfazer" })).toBeVisible();
});

test("a caixa de erro mostra o código do log e o copia (M12.1, OWASP A10)", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const box = page.getByRole("region", { name: "Erro" }).getByRole("alert");
  // O código é o "digest" que o instrumentation.ts grava no log, nunca a mensagem do erro
  await expect(box.getByTestId("codigo-do-erro")).toHaveText("1551172719");
  await box.getByRole("button", { name: "Copiar o código do erro" }).click();
  await expect(box.getByRole("button", { name: "Copiar o código do erro" })).toHaveText("Copiado");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("1551172719");
  await expect(box.getByRole("link", { name: "Voltar ao início" })).toHaveAttribute("href", "/");
});
