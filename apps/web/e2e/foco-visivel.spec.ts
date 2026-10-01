import { expect, test, type Locator, type Page } from "@playwright/test";

// Todas as páginas do app; o catálogo entra porque reúne todos os componentes
const PAGES = [
  "/",
  "/lancamentos",
  "/lancamentos/novo",
  "/orcamento",
  "/carteiras",
  "/ajustes",
  "/dev/ui",
] as const;

type Box = { x: number; y: number; width: number; height: number };

function overlaps(a: Box, b: Box): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

// Identifica o elemento focado (a posição no documento) e diz se ele mesmo é fixo:
// os links do cabeçalho, da barra, o "+" e o "Pular para o conteúdo" ficam por cima de tudo
async function focusedElement(page: Page): Promise<{ key: string; label: string; fixed: boolean }> {
  return page.evaluate(() => {
    const el = document.activeElement;
    if (!el || el === document.body) return { key: "body", label: "body", fixed: true };
    const fieldLabel = el instanceof HTMLInputElement ? el.labels?.[0]?.textContent : null;
    const label = (el.getAttribute("aria-label") ?? fieldLabel ?? el.textContent ?? el.tagName)
      .trim()
      .replace(/\s+/g, " ")
      .slice(0, 40);
    let node: Element | null = el;
    let fixed = false;
    while (node) {
      const position = getComputedStyle(node).position;
      if (position === "fixed" || position === "sticky") fixed = true;
      node = node.parentElement;
    }
    const key = String(Array.prototype.indexOf.call(document.querySelectorAll("*"), el));
    return { key, label: `${el.tagName.toLowerCase()} "${label}"`, fixed };
  });
}

// Elementos fixos que podem cobrir o conteúdo. Locators com vários elementos (os avisos
// empilhados) são conferidos um a um; os ausentes na página são ignorados
function fixedCovers(page: Page): [string, Locator][] {
  return [
    ["cabeçalho", page.locator("header")],
    ["barra inferior", page.getByRole("navigation", { name: "Principal" })],
    ["botão +", page.getByRole("link", { name: "Novo lançamento" })],
    ["aviso", page.locator("[data-sonner-toast]")],
  ];
}

// Percorre a página com Tab até o fim e volta com Shift+Tab até o começo, anotando cada
// elemento focado que fica sob algum elemento fixo
async function traverseAndCheck(page: Page): Promise<string[]> {
  const covers = fixedCovers(page);
  const problems: string[] = [];

  async function checkFocused(direction: string): Promise<string> {
    const focused = await focusedElement(page);
    if (focused.fixed) return focused.key;
    // activeElement em vez de ":focus": no campo de data o foco fica dentro do shadow DOM
    const handle = await page.evaluateHandle(() => document.activeElement);
    const box = await handle.asElement()?.boundingBox();
    await handle.dispose();
    if (!box) return focused.key;
    for (const [name, locator] of covers) {
      for (const cover of await locator.all()) {
        const coverBox = await cover.boundingBox();
        if (coverBox && overlaps(box, coverBox)) {
          problems.push(`${direction}: ${focused.label} fica sob o ${name}`);
        }
      }
    }
    return focused.key;
  }

  // Para quando um elemento se repete: o Tab deu a volta, ou o Sonner devolveu o foco ao
  // elemento de antes ao sair do aviso
  const visited = new Set<string>();
  for (let i = 0; i < 150; i++) {
    await page.keyboard.press("Tab");
    const key = await checkFocused("Tab");
    if (key === "body" || visited.has(key)) break;
    visited.add(key);
  }

  // Se o Tab deu a volta, o primeiro Shift+Tab sai da página (body); o seguinte entra de novo
  // pelo último elemento
  const back = new Set<string>();
  for (let i = 0; i < 150; i++) {
    await page.keyboard.press("Shift+Tab");
    const key = await checkFocused("Shift+Tab");
    if (key === "body") {
      if (back.size > 0) break;
      continue;
    }
    if (back.has(key)) break;
    back.add(key);
  }

  expect(visited.size, "a página precisa ter algo focável").toBeGreaterThan(0);
  expect(back.size, "o Shift+Tab precisa voltar pela página").toBeGreaterThan(1);
  return problems;
}

// Roda só no projeto "celular" (veja playwright.config.ts): só ali há cabeçalho fixo, barra e "+"
test.describe("foco sempre visível no celular", () => {
  for (const path of PAGES) {
    test(`${path}: nada fixo cobre o elemento focado, indo e voltando`, async ({ page }) => {
      await page.goto(path);
      await expect(page.locator("html")).toHaveAttribute("data-hydrated", "true");

      expect(await traverseAndCheck(page)).toEqual([]);
    });
  }

  test("/dev/ui com um aviso na tela: nem o aviso cobre o elemento focado", async ({ page }) => {
    // Relógio controlado: o aviso some em 10 s, e a varredura não pode depender disso
    await page.clock.install();
    await page.goto("/dev/ui");
    await expect(page.locator("html")).toHaveAttribute("data-hydrated", "true");

    // Exclui um item pelo teclado para abrir o aviso
    const remove = page.getByRole("button", { name: "Excluir Mercado (exemplo)" });
    for (let i = 0; i < 30; i++) {
      await page.keyboard.press("Tab");
      if (await remove.evaluate((el) => el === document.activeElement)) break;
    }
    await page.keyboard.press("Enter");
    const toast = page.locator("[data-sonner-toast]");
    await expect(toast).toBeVisible();

    // Congela o tempo para o aviso ficar na tela durante toda a varredura
    await page.clock.pauseAt(await page.evaluate(() => Date.now() + 50));

    // Começa pelo topo, como quem volta a percorrer a página
    await page.keyboard.press("Shift+Tab");
    const problems = await traverseAndCheck(page);
    await expect(toast).toBeVisible();
    expect(problems).toEqual([]);
  });
});
