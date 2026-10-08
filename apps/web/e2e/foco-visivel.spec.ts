import { expect, type Page } from "@playwright/test";
import {
  createTestUser,
  NO_SESSION,
  openCatalog,
  openPage,
  PAGES,
  PUBLIC_PAGES,
  startTwoFactor,
  test,
  testEmail,
} from "./helpers";

// WCAG 2.2, critério 2.4.11 (foco não encoberto): o elemento com foco não pode ficar escondido
// atrás do que fica fixo na tela. No FinTrack, isso é o cabeçalho e a barra de baixo do celular,
// o botão "+" e os avisos. Este teste percorre cada página com Tab e Shift+Tab e, a cada parada,
// mede se algum desses elementos cobre o elemento focado.

const MAX_STOPS = 60;

/** Diz o que está cobrindo o elemento focado, ou null se ele está inteiro à vista. */
async function focusProblem(page: Page): Promise<string | null> {
  return page.evaluate(async () => {
    // O ToastKeyboard rola até o elemento dois quadros de animação depois de mover o foco
    // (veja focusVisibly). Medir antes disso pegaria o elemento no meio do caminho.
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const el = document.activeElement as HTMLElement | null;
    if (!el || el === document.body || el.tagName === "MAIN") return null;
    const r = el.getBoundingClientRect();
    const name = el.getAttribute("aria-label") || el.textContent?.trim().slice(0, 40) || el.tagName;
    if (r.width <= 1 || r.height <= 1) return null; // sr-only ou invisível
    if (r.top < 0 || r.bottom > window.innerHeight) return `"${name}" está fora da tela`;

    // Anel do tema (regra do M02): o foco usa o anel de 3px na cor --ring, desenhado com
    // box-shadow pelo Tailwind (focus-visible:ring-3). O contorno fino padrão do navegador
    // não vale: some em fundos claros e muda de navegador para navegador.
    if (getComputedStyle(el).boxShadow === "none") {
      return `"${name}" usa o contorno do navegador, não o anel do tema`;
    }

    // Testa uma grade de pontos sobre o elemento: o que está por cima em cada ponto?
    // elementFromPoint respeita a ordem de empilhamento (z-index), como os olhos de quem vê a tela.
    const COVERS =
      'header, nav[aria-label="Principal"], a[aria-label="Novo lançamento"], [data-sonner-toast]';
    for (const fx of [0.1, 0.5, 0.9]) {
      for (const fy of [0.1, 0.5, 0.9]) {
        const x = r.left + r.width * fx;
        const y = r.top + r.height * fy;
        const hit = document.elementFromPoint(x, y);
        if (!hit || el.contains(hit) || hit.contains(el)) continue;
        const cover: HTMLElement | null = hit.closest<HTMLElement>(COVERS);
        if (cover && !cover.contains(el)) {
          const b = cover.getBoundingClientRect();
          const who = cover.hasAttribute("data-sonner-toast")
            ? "um aviso"
            : cover.getAttribute("aria-label") || cover.tagName.toLowerCase();
          return `"${name}" (y=${Math.round(r.top)}–${Math.round(r.bottom)}) fica embaixo de ${who} (y=${Math.round(b.top)}–${Math.round(b.bottom)})`;
        }
      }
    }
    return null;
  });
}

/** Percorre a página com a tecla indicada e devolve todos os problemas encontrados. */
async function tour(page: Page, key: "Tab" | "Shift+Tab"): Promise<string[]> {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < MAX_STOPS; i++) {
    await page.keyboard.press(key);
    const id = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el || el === document.body) return "body";
      return el.outerHTML.slice(0, 200);
    });
    if (id === "body" || seen.has(id)) break; // deu a volta
    seen.add(id);
    const problem = await focusProblem(page);
    if (problem) problems.push(problem);
  }
  return problems;
}

for (const path of PAGES) {
  test(`${path}: o foco nunca fica escondido (Tab e Shift+Tab)`, async ({ page }) => {
    await openPage(page, path);
    expect(await tour(page, "Tab")).toEqual([]);
    expect(await tour(page, "Shift+Tab")).toEqual([]);
  });
}

test.describe("telas de entrada, sem sessão", () => {
  test.use({ storageState: NO_SESSION });
  for (const path of PUBLIC_PAGES) {
    test(`${path}: o foco nunca fica escondido (Tab e Shift+Tab)`, async ({ page }) => {
      await openPage(page, path);
      expect(await tour(page, "Tab")).toEqual([]);
      expect(await tour(page, "Shift+Tab")).toEqual([]);
    });
  }
});

test.describe("com um aviso na tela", () => {
  // Passa o mouse sobre o aviso: o Sonner pausa o tempo e o aviso fica na tela durante o teste
  async function keepToastOpen(page: Page) {
    const toast = page.locator("[data-sonner-toast]").first();
    await expect(toast).toBeVisible();
    await toast.hover();
  }

  test("o foco que vai sozinho para a próxima lixeira fica acima do aviso", async ({ page }) => {
    await openCatalog(page);
    await page.getByRole("button", { name: "Excluir Salário (exemplo)" }).focus();
    await page.keyboard.press("Enter");
    const farmacia = page.getByRole("button", { name: "Excluir Farmácia (exemplo)" });
    await expect(farmacia).toBeFocused();
    await expect.poll(() => focusProblem(page)).toBeNull();
  });

  test("lista vazia: o aviso não cobre a mensagem que recebe o foco", async ({ page }) => {
    await openCatalog(page);
    for (const nome of ["Mercado", "Salário", "Farmácia"]) {
      await page.getByRole("button", { name: `Excluir ${nome} (exemplo)` }).focus();
      await page.keyboard.press("Enter");
    }
    await expect(page.getByText(/^Lista vazia/)).toBeFocused();
    await expect.poll(() => focusProblem(page)).toBeNull();
  });

  test("Tab e Shift+Tab pela página inteira com o aviso aberto", async ({ page }) => {
    await openCatalog(page);
    await page.getByRole("button", { name: "Excluir Mercado (exemplo)" }).focus();
    await page.keyboard.press("Enter");
    await keepToastOpen(page);
    expect(await tour(page, "Tab")).toEqual([]);
    expect(await tour(page, "Shift+Tab")).toEqual([]);
    await expect(page.locator("[data-sonner-toast]")).toHaveCount(1);
  });
});

test.describe("saindo do aviso pelo teclado", () => {
  const inToaster = (page: Page) =>
    page.evaluate(() => Boolean(document.activeElement?.closest("[data-sonner-toaster]")));
  const focusVisible = (page: Page) =>
    page.evaluate(() => document.activeElement?.matches(":focus-visible") ?? false);

  // Tab até o foco sair dos avisos (cada aviso tem 3 paradas: ele, o Fechar e o Desfazer)
  async function tabOut(page: Page) {
    for (let i = 0; i < 15 && (await inToaster(page)); i++) await page.keyboard.press("Tab");
  }

  test("o foco volta com anel para onde estava e o próximo Tab não entra de novo no aviso", async ({
    page,
  }) => {
    await openCatalog(page);
    await page.getByRole("button", { name: "Excluir Mercado (exemplo)" }).focus();
    await page.keyboard.press("Enter");
    const salario = page.getByRole("button", { name: "Excluir Salário (exemplo)" });
    await expect(salario).toBeFocused();

    await page.keyboard.press("Alt+T");
    expect(await inToaster(page)).toBe(true);
    await tabOut(page);

    await expect(salario).toBeFocused();
    expect(await focusVisible(page)).toBe(true);
    await expect.poll(() => focusProblem(page)).toBeNull();

    // Sem girar: os próximos Tabs seguem a página
    await page.keyboard.press("Tab");
    expect(await inToaster(page)).toBe(false);
    await expect(salario).not.toBeFocused();
    expect(await focusVisible(page)).toBe(true);
  });

  test("com três avisos, a pilha aberta pelo Alt+T recolhe e não cobre o foco", async ({
    page,
  }) => {
    await openCatalog(page);
    await page.getByRole("button", { name: "Excluir Mercado (exemplo)" }).focus();
    const vazia = page.getByText(/^Lista vazia/);
    // A cada Enter, o foco passa sozinho para a próxima lixeira, até a lista ficar vazia
    for (const proximo of [
      page.getByRole("button", { name: "Excluir Salário (exemplo)" }),
      page.getByRole("button", { name: "Excluir Farmácia (exemplo)" }),
      vazia,
    ]) {
      await page.keyboard.press("Enter");
      await expect(proximo).toBeFocused();
    }
    await expect(page.locator("[data-sonner-toast]")).toHaveCount(3);

    await page.keyboard.press("Alt+T");
    await tabOut(page);
    await expect(vazia).toBeFocused();
    expect(await focusVisible(page)).toBe(true);
    await expect.poll(() => focusProblem(page)).toBeNull();
  });
});

test("o campo Data mostra o anel do app também no botão do calendário", async ({ page }) => {
  await openPage(page, "/lancamentos/novo");
  // Desde o M07 a data mora em "Mais opções" (o lançamento rápido já vem com a data de hoje)
  const more = page.locator("summary").filter({ hasText: "Mais opções" });
  await more.click();
  await more.focus();
  const data = page.getByLabel("Data");
  // dia, mês, ano e o botão do calendário: o anel aparece em todas as paradas
  for (let i = 0; i < 4; i++) {
    await page.keyboard.press("Tab");
    await expect(data).toBeFocused();
    // O anel é uma sombra de 3px com cor (as demais sombras são transparentes)
    const shadow = await data.evaluate((el) => getComputedStyle(el).boxShadow);
    expect(shadow).toMatch(/(lab|oklch|oklab)\([^)]*\) 0px 0px 0px 3px/);
  }
});

// WCAG 2.2, critério 1.4.11: o anel de foco precisa de contraste de pelo menos 3:1.
// Confere que nenhum anel ou contorno de foco usa cor com transparência (o padrão ring/50 do shadcn).
test("os anéis de foco usam cor cheia", async ({ page }) => {
  await openCatalog(page);
  const transparentes = await page.evaluate(() => {
    const found = new Set<string>();
    for (const sheet of [...document.styleSheets]) {
      let rules: CSSRuleList;
      try {
        rules = sheet.cssRules;
      } catch {
        continue;
      }
      const walk = (list: CSSRuleList) => {
        for (const rule of [...list]) {
          if ("cssRules" in rule && (rule as CSSGroupingRule).cssRules)
            walk((rule as CSSGroupingRule).cssRules);
          if (rule instanceof CSSStyleRule && /focus|ring|outline/.test(rule.selectorText)) {
            const s = rule.style;
            const color =
              s.getPropertyValue("--tw-ring-color") + " " + s.getPropertyValue("outline-color");
            if (/ring|destructive/.test(color) && /\d+%|\/\s*0?\.\d|color-mix/.test(color))
              found.add(rule.selectorText);
          }
        }
      };
      walk(rules);
    }
    return [...found];
  });
  expect(transparentes).toEqual([]);
});

test.describe("tela do código, depois da senha", () => {
  test.use({ storageState: NO_SESSION });
  test("/entrar/dois-fatores: o foco nunca fica escondido (Tab e Shift+Tab)", async ({
    page,
    request,
  }, testInfo) => {
    const email = testEmail("foco-dois-fatores", testInfo.project.name);
    const password = "frase longa para o teste de foco";
    await createTestUser(request, { email, password });
    await startTwoFactor(page, email, password);
    expect(await tour(page, "Tab")).toEqual([]);
    expect(await tour(page, "Shift+Tab")).toEqual([]);
  });
});
