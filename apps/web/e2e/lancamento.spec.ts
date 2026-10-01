import { expect, test } from "@playwright/test";
import { brl, openPage } from "./helpers";

test.beforeEach(async ({ page }) => {
  await openPage(page, "/lancamentos/novo");
});

test("o campo de valor preenche como uma maquininha", async ({ page }) => {
  const valor = page.getByLabel("Valor");
  await valor.click();
  await valor.pressSequentially("123456");
  await expect(valor).toHaveValue(brl("R$ 1.234,56"));

  await valor.press("Backspace");
  await expect(valor).toHaveValue(brl("R$ 123,45"));
});

test("colar um valor formatado substitui o campo", async ({ page, context, browserName }) => {
  test.skip(browserName !== "chromium", "permissão de área de transferência só no Chromium");
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const valor = page.getByLabel("Valor");
  await valor.click();
  await page.evaluate(() => navigator.clipboard.writeText("1.234,56"));
  await valor.press("ControlOrMeta+V");
  await expect(valor).toHaveValue(brl("R$ 1.234,56"));
});

test("mostra os erros e só salva com valor e descrição", async ({ page }) => {
  await page.getByRole("button", { name: "Salvar lançamento" }).click();
  await expect(page.getByText("Informe um valor maior que zero.")).toBeVisible();
  await expect(page.getByText("Descreva o lançamento")).toBeVisible();
  await expect(page.getByLabel("Valor")).toHaveAttribute("aria-invalid", "true");
  // O foco vai para o primeiro campo com erro
  await expect(page.getByLabel("Valor")).toBeFocused();

  await page.getByLabel("Valor").pressSequentially("4235");
  await page.getByLabel("Descrição").fill("Mercado");
  await page.getByRole("button", { name: "Salvar lançamento" }).click();

  await expect(page.getByText(brl("Despesa de R$ 42,35 registrada"))).toBeVisible();
  await expect(page.getByLabel("Valor")).toHaveValue(brl("R$ 0,00"));
});

test("Desfazer devolve o que foi apagado do formulário", async ({ page }) => {
  await page.getByText("Receita", { exact: true }).click(); // clica no rótulo, como uma pessoa
  await page.getByLabel("Valor").pressSequentially("850000");
  await page.getByLabel("Descrição").fill("Salário");
  await page.getByRole("button", { name: "Salvar lançamento" }).click();

  await page.getByRole("button", { name: "Desfazer" }).click();
  await expect(page.getByLabel("Valor")).toBeFocused(); // o foco volta ao formulário
  await expect(page.getByLabel("Descrição")).toHaveValue("Salário");
  await expect(page.getByLabel("Valor")).toHaveValue(brl("R$ 8.500,00"));
  await expect(page.getByRole("radio", { name: "Receita" })).toBeChecked();
});

test("o tipo do lançamento se escolhe com as setas do teclado", async ({ page }) => {
  await page.getByRole("radio", { name: "Despesa" }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("radio", { name: "Receita" })).toBeChecked();
});

test("o erro de cada campo some quando ele fica válido", async ({ page }) => {
  await page.getByRole("button", { name: "Salvar lançamento" }).click();
  await page.getByLabel("Valor").pressSequentially("4235");
  await expect(page.getByText("Informe um valor maior que zero.")).toHaveCount(0);
  await expect(page.getByText("Descreva o lançamento")).toBeVisible();

  await page.getByLabel("Descrição").pressSequentially("M");
  await expect(page.getByText("Descreva o lançamento")).toHaveCount(0);
});

test("descrição só com espaços é recusada e recebe o foco", async ({ page }) => {
  await page.getByLabel("Valor").pressSequentially("100");
  await page.getByLabel("Descrição").fill("   ");
  await page.getByRole("button", { name: "Salvar lançamento" }).click();
  await expect(page.getByText("Descreva o lançamento")).toBeVisible();
  await expect(page.getByLabel("Descrição")).toBeFocused();
});
