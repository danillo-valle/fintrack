// Formulários com Server Action (ActionForm) e a preservação de telas do Cache Components (M08):
//
//   1. O HTML que o servidor manda já traz a Server Action no <form>: um clique antes do
//      JavaScript carregar não se perde (aprimoramento progressivo). Se alguém embrulhar a action
//      numa função do navegador, o React escreve um action que não é http(s) e este teste pega.
//      (Foi o que aconteceu no M08: no N150, com a página compilando, o clique em "Lançar as
//      deste mês" chegava antes do JavaScript e sumia.)
//   2. Com a página à vista e o React ainda sem carregar, o clique vira um envio do navegador,
//      chega ao servidor e a resposta traz o resultado da action (no pnpm dev e em produção).
//   3. Depois de um envio, sair da tela e voltar mostra o formulário novo, sem o aviso de antes
//      (a tela fica escondida no documento, e o ActionForm monta de novo).
//   4. (M10.0) Nenhum formulário manda senha, e-mail ou código pela URL, nem antes do React.
//
// Dados sintéticos: um lar novo por teste, só com a Bia.
import { expect, type Browser, type Page, type TestInfo } from "@playwright/test";
import {
  apiHeaders,
  BASE_URL,
  createHouseholdDirect,
  createTestUser,
  deleteHouseholds,
  deleteUser,
  fakeIp,
  NO_SESSION,
  openPage,
  PAGES,
  personInNewTab,
  PUBLIC_PAGES,
  test,
  testEmail,
} from "./helpers";

const NADA_NOVO = "Nada novo: as recorrências deste mês já estavam lançadas.";
const SENHA = "uma frase longa so para testes";

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

/** Como cada formulário da página sai do servidor (sem JavaScript). */
async function formsOn(page: Page, path: string) {
  await page.goto(path);
  return page.locator("form").evaluateAll((forms) =>
    forms.map((form) => ({
      protocol: new URL(form.getAttribute("action") ?? "", location.href).protocol,
      method: (form.getAttribute("method") ?? "").toLowerCase(),
      sensitive: Boolean(
        form.querySelector(
          'input[type="password"], input[type="email"], input[autocomplete="one-time-code"]',
        ),
      ),
    })),
  );
}

/**
 * M10.0: todo formulário declara o método, e senha, e-mail ou código só vão por POST. Sem método,
 * o navegador usa GET: um clique antes de o React ligar o formulário punha os campos na URL.
 */
function expectNothingInUrl(forms: Awaited<ReturnType<typeof formsOn>>, path: string) {
  for (const [i, form] of forms.entries()) {
    const where = `${path}, formulário ${i + 1}`;
    expect(form.method, `${where}: sem método (o navegador usa GET)`).not.toBe("");
    if (form.sensitive) expect(form.method, `${where}: campo sensível por GET`).toBe("post");
  }
}

test.describe("antes do JavaScript", () => {
  test.use({ javaScriptEnabled: false });

  test("todo formulário do app sai do servidor ligado à action e sem nada na URL", async ({
    page,
  }) => {
    test.slow();
    for (const path of PAGES) {
      const forms = await formsOn(page, path);
      // Lista permitida, não lista negada: o envio vai para http(s), o próprio servidor. Qualquer
      // outro esquema (o "javascript:throw…" do React, data:, vbscript:…) reprova. (Conferir por
      // "começa com javascript:" é o que o CodeQL acusa como js/incomplete-url-scheme-check.)
      const lost = forms.filter((f) => f.protocol !== "http:" && f.protocol !== "https:");
      expect(lost, `${path}: formulário que só funciona depois do JavaScript`).toEqual([]);
      // A Segurança tem a troca de senha e os códigos de backup (cliente do Better Auth)
      expectNothingInUrl(forms, path);
    }
  });

  // M10.0: os formulários que dependem do React (o cliente do Better Auth: entrar, 2FA, senha)
  // saíam sem método. Um clique antes do React ligar o formulário (página à vista, JavaScript ainda
  // chegando: visto no N150 com a suíte inteira) mandava e-mail, senha ou código na URL
  // ("/entrar/dois-fatores?code=…"), que fica no histórico e nos logs. As telas do app estão no
  // teste de cima; aqui, as de entrada.
  test("nenhuma tela de entrada manda senha, e-mail ou código pela URL", async ({
    browser,
    request,
  }, testInfo) => {
    // Sem sessão (com a sessão da Ana, as telas de entrar redirecionariam)
    const anonymous = await browser.newContext({
      javaScriptEnabled: false,
      storageState: NO_SESSION,
    });
    const open = await anonymous.newPage();
    let seen = 0;
    const check = async (target: Page, path: string) => {
      const forms = await formsOn(target, path);
      expectNothingInUrl(forms, path);
      seen += forms.length;
    };
    for (const path of [...PUBLIC_PAGES, "/redefinir-senha?token=token-qualquer"]) {
      await check(open, path);
    }
    // A tela do código só abre com o cookie de "senha certa, falta o código"
    await anonymous.addCookies([{ name: "fintrack.two_factor", value: "qualquer", url: BASE_URL }]);
    await check(open, "/entrar/dois-fatores");
    await anonymous.close();

    // Configurar o 2FA: uma conta ainda sem 2FA, logada pela API
    const email = testEmail("form-metodo", testInfo.project.name);
    await createTestUser(request, { email, password: SENHA, twoFactor: false });
    const signIn = await request.post("/api/auth/sign-in/email", {
      headers: apiHeaders(fakeIp()),
      data: { email, password: SENHA },
    });
    expect(signIn.ok(), await signIn.text()).toBe(true);
    const fresh = await browser.newContext({
      javaScriptEnabled: false,
      storageState: await request.storageState(),
    });
    await check(await fresh.newPage(), "/configurar-2fa");
    await fresh.close();
    await deleteUser(email);
    // entrar, cadastro, esqueci, redefinir, 2FA e configurar (2 passos no mesmo HTML: 1 visível)
    expect(seen, "poucos formulários conferidos: a lista de telas mudou?").toBeGreaterThanOrEqual(
      6,
    );
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

test("antes do React carregar, entrar e o código do 2FA não deixam nada na URL", async ({
  browser,
}) => {
  // O que o N150 mostrou no M10.0 ("/entrar/dois-fatores?code=…"), agora de propósito: a página
  // aparece, o React não chega, e a pessoa envia. O envio vai por POST para a própria página, que só
  // se mostra de novo; nem o e-mail, nem a senha, nem o código vão para a URL.
  const context = await browser.newContext({
    storageState: NO_SESSION,
    locale: "pt-BR",
    timezoneId: "America/Sao_Paulo",
  });
  await context.route("**/_next/static/**/*.js", (route) => route.abort());
  const page = await context.newPage();
  const sendWithoutReact = async (path: string, fill: () => Promise<void>, button: string) => {
    await page.goto(path);
    await expect(page.locator("html[data-hydrated]")).toHaveCount(0);
    await fill();
    // O envio do navegador é uma navegação da página inteira; GET ou POST, ela acontece
    const navigation = page.waitForRequest((r) => r.isNavigationRequest());
    await page.getByRole("button", { name: button, exact: true }).click();
    const request = await navigation;
    expect(request.method(), `${path}: o envio foi por GET`).toBe("POST");
    expect((await request.response())?.status()).toBe(200);
    expect(new URL(page.url()).search, `${path}: campos na URL`).toBe("");
  };

  await sendWithoutReact(
    "/entrar",
    async () => {
      await page.getByLabel("E-mail").fill("ninguem@fintrack.test");
      await page.getByLabel("Senha", { exact: true }).fill(SENHA);
    },
    "Entrar",
  );
  await context.addCookies([{ name: "fintrack.two_factor", value: "qualquer", url: BASE_URL }]);
  await sendWithoutReact(
    "/entrar/dois-fatores",
    () => page.getByLabel("Código do app autenticador").fill("123456"),
    "Confirmar",
  );
  await context.close();
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
