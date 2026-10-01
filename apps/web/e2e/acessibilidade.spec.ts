import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { openPage, PAGES } from "./helpers";

// Regras da WCAG até a versão 2.2, níveis A e AA
const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

for (const scheme of ["light", "dark"] as const) {
  test.describe(`tema ${scheme === "light" ? "claro" : "escuro"}`, () => {
    test.use({ colorScheme: scheme });

    for (const path of PAGES) {
      test(`${path} não tem violações de acessibilidade`, async ({ page }) => {
        await openPage(page, path);
        await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
        const results = await new AxeBuilder({ page }).withTags(WCAG).analyze();
        // Se falhar, a lista mostra a regra, o elemento e como corrigir
        expect(
          results.violations.map((v) => ({
            regra: v.id,
            impacto: v.impact,
            onde: v.nodes.map((n) => n.target),
          })),
        ).toEqual([]);
      });
    }
  });
}
