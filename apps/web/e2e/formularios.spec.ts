// Formulários com Server Action (ActionForm) e a preservação de telas do Cache Components (M08):
//
//   1. O HTML que o servidor manda já traz a Server Action no <form>: um clique antes do
//      JavaScript carregar não se perde (aprimoramento progressivo). Se alguém embrulhar a action
//      numa função do navegador, o React escreve action="javascript:throw…" e este teste pega.
//      (Foi o que aconteceu no M08: no N150, com a página compilando, o clique em "Lançar as
//      deste mês" chegava antes do JavaScript e sumia.)
//   2. Com a página à vista e o React ainda sem carregar, o clique vira um envio do navegador,
//      chega ao servidor e a resposta traz o resultado da action (no pnpm dev e em produção).
//   3. Depois de um envio, sair da tela e voltar mostra o formulário novo, sem o aviso de antes
//      (a tela fica escondida no documento, e o ActionForm monta de novo).
//
// Dados sintéticos: um lar novo por teste, só com a Bia.
import { expect, type Browser, type TestInfo } from "@playwright/test";
import {
  createHouseholdDirect,
  deleteHouseholds,
  openPage,
  PAGES,
  personInNewTab,
  test,
  testEmail,
} from "./helpers";

const NADA_NOVO = "Nada novo: as recorrências deste mês já estavam lançadas.";

const created: string[] = [];
test.afterEach(async () => {
  await deleteHouseholds(created.splice(0));
});

async function alone(browser: Browser, testInfo: TestInfo, slug: string) {
  const email = testEmail(`form-${slug}`, testInfo.project.name);
  const person = await personInNewTab(browser, email, "Bia Teste");
  const home = await createHouseholdDirect({
    name: `Lar ${slug}`,
    people: [{ email, role: "OWNER" }],
  });
  created.push(home.householdId);
  return person;
}

test.describe("antes do JavaScript", () => {
  test.use({ javaScriptEnabled: false });

  test("todo formulário do app sai do servidor já ligado à Server Action", async ({ page }) => {
    test.slow();
    for (const path of PAGES) {
      await page.goto(path);
      const actions = await page
        .locator("form")
        .evaluateAll((forms) => forms.map((f) => f.getAttribute("action") ?? ""));
      const lost = actions.filter((a) => a.startsWith("javascript:"));
      expect(lost, `${path}: formulário que só funciona depois do JavaScript`).toEqual([]);
    }
  });
});

test("antes do React carregar, Lançar as deste mês chega ao servidor e roda a action", async ({
  browser,
}, testInfo) => {
  const p = await alone(browser, testInfo, "antes-do-react");
  // A mesma sessão, com os pacotes de JavaScript do app barrados: a página chega e aparece, mas o
  // React não hidrata. É o que acontece por alguns segundos numa máquina lenta. O clique vira um
  // envio do próprio navegador (POST da página inteira), e a resposta traz o resultado da action.
  //
  // O que este teste NÃO afirma: o aviso à vista depois. No pnpm dev ele aparece; no build de
  // produção, com o Cache Components, o React acusa diferença de hidratação (#418) nessa resposta
  // e refaz a tela sem o aviso (a action rodou; só a confirmação some). Visto com o ActionForm do
  // M07.4 também: é do Next, não do formulário. Pendência registrada no ADR-010.
  const context = await browser.newContext({
    storageState: await p.context.storageState(),
    locale: "pt-BR",
    timezoneId: "America/Sao_Paulo",
  });
  await context.route("**/_next/static/**/*.js", (route) => route.abort());
  const page = await context.newPage();
  await page.goto("/lancamentos/recorrencias");
  await expect(page.locator("html[data-hydrated]")).toHaveCount(0);

  const response = page.waitForResponse(
    (r) => r.request().method() === "POST" && r.request().resourceType() === "document",
  );
  await page.getByRole("button", { name: "Lançar as deste mês" }).click();
  const answer = await response;
  expect(answer.status()).toBe(200);
  expect(await answer.text()).toContain(NADA_NOVO);
  await context.close();
  await p.close();
});

test("depois de um envio, sair e voltar mostra o formulário sem o aviso de antes", async ({
  browser,
}, testInfo) => {
  const p = await alone(browser, testInfo, "voltar");
  const page = p.page;
  await openPage(page, "/lancamentos/recorrencias");
  await page.getByRole("button", { name: "Lançar as deste mês" }).click();
  await expect(page.getByText(NADA_NOVO)).toBeVisible();

  // Navegação dentro do app (link do menu, sem recarregar): Recorrências fica escondida no documento
  await page
    .getByRole("link", { name: "Início", exact: true })
    .filter({ visible: true })
    .first()
    .click();
  await expect(page.getByRole("heading", { level: 1, name: "Início" })).toBeVisible();
  await expect(page.getByText(NADA_NOVO)).toBeHidden();
  await page.goBack();
  await expect(page).toHaveURL(/\/lancamentos\/recorrencias$/);
  await expect(page.getByRole("button", { name: "Lançar as deste mês" })).toBeVisible();
  await expect(page.getByText(NADA_NOVO)).toBeHidden();
  await p.close();
});
