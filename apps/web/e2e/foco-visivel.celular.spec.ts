import { expect, test } from "@playwright/test";

type Box = { x: number; y: number; width: number; height: number };

function overlaps(a: Box, b: Box): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

// WCAG 2.4.11: o elemento focado não pode ficar escondido atrás do "+" nem da barra inferior
test("a lixeira focada por Tab não fica sob o botão + nem sob a barra inferior", async ({
  page,
}) => {
  await page.goto("/dev/ui");
  await expect(page.locator("html")).toHaveAttribute("data-hydrated", "true");

  // Chega na lixeira só com Tab, desde o começo da página, como quem navega pelo teclado
  const trash = page.getByRole("button", { name: "Excluir Farmácia (exemplo)" });
  for (let i = 0; i < 30; i++) {
    await page.keyboard.press("Tab");
    if (await trash.evaluate((el) => el === document.activeElement)) break;
  }
  await expect(trash).toBeFocused();

  const trashBox = await trash.boundingBox();
  const fabBox = await page.getByRole("link", { name: "Novo lançamento" }).boundingBox();
  const navBox = await page.getByRole("navigation", { name: "Principal" }).boundingBox();
  if (!trashBox || !fabBox || !navBox) throw new Error("elemento sem caixa na tela");

  expect(overlaps(trashBox, fabBox), "lixeira sob o botão +").toBe(false);
  expect(overlaps(trashBox, navBox), "lixeira sob a barra inferior").toBe(false);
});
