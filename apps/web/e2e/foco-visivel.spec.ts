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

// Roda só no projeto "celular" (veja playwright.config.ts): só ali há cabeçalho fixo, barra e "+"
test.describe("foco sempre visível no celular", () => {
  for (const path of PAGES) {
    test(`${path}: nada fixo cobre o elemento focado, indo e voltando`, async ({ page }) => {
      await page.goto(path);
      await expect(page.locator("html")).toHaveAttribute("data-hydrated", "true");

      const covers: [string, Locator][] = [
        ["cabeçalho", page.locator("header")],
        ["barra inferior", page.getByRole("navigation", { name: "Principal" })],
        ["botão +", page.getByRole("link", { name: "Novo lançamento" })],
      ];
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
          if ((await locator.count()) === 0) continue;
          const cover = await locator.boundingBox();
          if (cover && overlaps(box, cover)) {
            problems.push(`${direction}: ${focused.label} fica sob o ${name}`);
          }
        }
        return focused.key;
      }

      // Vai com Tab até o fim (o foco sai da página ou volta ao primeiro elemento)
      const visited: string[] = [];
      for (let i = 0; i < 150; i++) {
        await page.keyboard.press("Tab");
        const key = await checkFocused("Tab");
        if (key === "body" || key === visited[0]) break;
        visited.push(key);
      }

      // Volta com Shift+Tab até o começo. Se o Tab deu a volta, o primeiro Shift+Tab sai da
      // página (body); o seguinte entra de novo pelo último elemento
      let steps = 0;
      for (let i = 0; i < 150; i++) {
        await page.keyboard.press("Shift+Tab");
        const key = await checkFocused("Shift+Tab");
        if (key === "body") {
          if (steps > 0) break;
          continue;
        }
        steps++;
        if (key === visited[0]) break;
      }
      expect(steps, "o Shift+Tab precisa voltar pela página").toBeGreaterThan(1);

      expect(visited.length, "a página precisa ter algo focável").toBeGreaterThan(0);
      expect(problems).toEqual([]);
    });
  }
});
