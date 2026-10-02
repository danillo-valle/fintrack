import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import {
  apiHeaders,
  createTestUser,
  fakeIp,
  NO_SESSION,
  openPage,
  PAGES,
  PUBLIC_PAGES,
  startTwoFactor,
  testEmail,
} from "./helpers";

// Regras da WCAG até a versão 2.2, níveis A e AA
const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

async function checkAxe(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  // Se falhar, a lista mostra a regra, o elemento e como corrigir
  expect(
    results.violations.map((v) => ({
      regra: v.id,
      impacto: v.impact,
      onde: v.nodes.map((n) => n.target),
    })),
  ).toEqual([]);
}

async function expectNoViolations(page: Page, path: string) {
  await openPage(page, path);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await checkAxe(page);
}

for (const scheme of ["light", "dark"] as const) {
  test.describe(`tema ${scheme === "light" ? "claro" : "escuro"}`, () => {
    test.use({ colorScheme: scheme });

    // Páginas do app, com a sessão da conta de teste
    for (const path of PAGES) {
      test(`${path} não tem violações de acessibilidade`, async ({ page }) => {
        await expectNoViolations(page, path);
      });
    }

    // Telas de entrada, sem sessão
    test.describe("sem sessão", () => {
      test.use({ storageState: NO_SESSION });
      for (const path of PUBLIC_PAGES) {
        test(`${path} não tem violações de acessibilidade`, async ({ page }) => {
          await expectNoViolations(page, path);
        });
      }
    });
  });
}

// Telas que dependem de um estado da conta: ligar o 2FA (conta sem 2FA) e reautenticar
test.describe("ligar o 2FA e reautenticar", () => {
  test.use({ storageState: NO_SESSION });

  test("/configurar-2fa nos três passos não tem violações", async ({ page }, testInfo) => {
    const email = testEmail("a11y-2fa", testInfo.project.name);
    const password = "frase longa para acessibilidade";
    await createTestUser(page.request, { email, password, twoFactor: false });
    const signIn = await page.request.post("/api/auth/sign-in/email", {
      headers: apiHeaders(fakeIp()),
      data: { email, password },
    });
    expect(signIn.ok()).toBe(true);

    await openPage(page, "/configurar-2fa");
    await checkAxe(page); // passo 1: senha
    await page.getByLabel("Confirme sua senha").fill(password);
    await page.getByRole("button", { name: "Continuar" }).click();
    await expect(page.getByRole("heading", { name: /Passo 2 de 3/ })).toBeFocused();
    await page.getByText("Não consegue ler? Digite a chave").click();
    await checkAxe(page); // passo 2: QR code e chave
  });

  test("/entrar/dois-fatores nos dois modos e com erro não tem violações", async ({
    page,
    request,
  }, testInfo) => {
    const email = testEmail("a11y-dois-fatores", testInfo.project.name);
    const password = "frase longa para acessibilidade";
    await createTestUser(request, { email, password });
    await startTwoFactor(page, email, password);
    await checkAxe(page); // app autenticador
    await page.getByRole("button", { name: "Confirmar" }).click();
    await expect(page.getByLabel("Código do app autenticador")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    await checkAxe(page); // com o aviso do campo
    await page.getByRole("button", { name: "Usar um código de backup" }).click();
    await checkAxe(page); // código de backup
  });

  test("/reautenticar não tem violações", async ({ page }, testInfo) => {
    const email = testEmail("a11y-reauth", testInfo.project.name);
    const password = "frase longa para acessibilidade";
    await createTestUser(page.request, { email, password });
    await openPage(page, "/reautenticar?next=%2Fajustes%2Fseguranca");
    await expect(
      page.getByRole("heading", { level: 1, name: "Confirme que é você" }),
    ).toBeVisible();
    await checkAxe(page);
  });
});
