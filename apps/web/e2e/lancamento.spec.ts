import { expect, test } from "@playwright/test";

test("mostra os erros e só salva com valor e descrição", async ({ page }) => {
  await page.goto("/lancamentos/novo");
  await expect(page.locator("html")).toHaveAttribute("data-hydrated", "true");

  const amount = page.getByLabel("Valor", { exact: true });
  const description = page.getByLabel("Descrição");
  const save = page.getByRole("button", { name: "Salvar lançamento" });
  const amountError = page.getByText("Informe um valor maior que zero.");
  const descriptionError = page.getByText("Descreva o lançamento, por exemplo: Mercado.");
  const toasts = page.locator("[data-sonner-toast]");

  // Tudo vazio: os dois erros aparecem e o foco vai para o primeiro campo inválido
  await save.focus();
  await page.keyboard.press("Enter");
  await expect(amountError).toBeVisible();
  await expect(descriptionError).toBeVisible();
  await expect(amount).toHaveAttribute("aria-invalid", "true");
  await expect(amount).toBeFocused();
  await expect(toasts).toHaveCount(0);

  // Corrigir o valor apaga o erro dele na hora, sem esperar o próximo envio
  await page.keyboard.type("4235");
  await expect(amountError).toBeHidden();
  await expect(amount).not.toHaveAttribute("aria-invalid");
  await expect(descriptionError).toBeVisible();

  // Só o valor preenchido: o erro de descrição continua e o foco vai para ela
  await save.focus();
  await page.keyboard.press("Enter");
  await expect(amountError).toBeHidden();
  await expect(descriptionError).toBeVisible();
  await expect(description).toBeFocused();
  await expect(toasts).toHaveCount(0);

  // Corrigir a descrição também apaga o erro dela na hora
  await page.keyboard.type("Mercado");
  await expect(descriptionError).toBeHidden();
  await expect(description).not.toHaveAttribute("aria-invalid");

  // Valor e descrição: salva, limpa o formulário e não mostra erro
  await page.keyboard.press("Enter");
  await expect(toasts.filter({ hasText: "R$ 42,35 registrada" })).toBeVisible();
  await expect(descriptionError).toBeHidden();
  await expect(amount).toHaveValue(/^R\$\s0,00$/);
  await expect(description).toHaveValue("");
});
