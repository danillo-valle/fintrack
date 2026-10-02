// Autenticação de ponta a ponta: o que o M03 promete, conferido num navegador de verdade.
import { expect } from "@playwright/test";
import {
  ageSessions,
  apiHeaders,
  clearEmails,
  countEmails,
  createTestUser,
  fakeIp,
  formAlert,
  linkFromEmail,
  NO_SESSION,
  openPage,
  PAGES,
  signInThroughUi,
  sql,
  startTwoFactor,
  test,
  testEmail,
  totp,
} from "./helpers";

const PASSWORD = "uma frase longa so para testes";

test.describe("sem sessão", () => {
  test.use({ storageState: NO_SESSION });

  test("toda página do app manda para /entrar, guardando o destino", async ({ page }) => {
    for (const path of PAGES) {
      await page.goto(path);
      const expected = path === "/" ? "/entrar" : `/entrar?next=${encodeURIComponent(path)}`;
      await expect(page, `abrindo ${path}`).toHaveURL(expected);
    }
  });

  test("no login, o Tab vai do e-mail direto para a senha", async ({ page }) => {
    await openPage(page, "/entrar");
    await page.getByLabel("E-mail").focus();
    await page.keyboard.press("Tab");
    await expect(page.getByLabel("Senha", { exact: true })).toBeFocused();
  });

  test("um cookie de sessão inventado não abre o app", async ({ page, context }) => {
    // O proxy.ts só vê que o cookie existe; quem confere no banco é o requireUser()
    await context.addCookies([
      { name: "fintrack.session_token", value: "falso.falso", url: "http://localhost:3000" },
    ]);
    await page.goto("/lancamentos");
    await expect(page).toHaveURL("/entrar?next=%2Flancamentos");
  });

  test("entrar com senha e código do app volta para a página pedida", async ({
    page,
    request,
  }, testInfo) => {
    const email = testEmail("login", testInfo.project.name);
    const { secret } = await createTestUser(request, { email, password: PASSWORD });

    await page.goto("/lancamentos");
    await expect(page).toHaveURL("/entrar?next=%2Flancamentos");
    await expect(page.locator("html[data-hydrated]")).toBeAttached();
    await page.getByLabel("E-mail").fill(email);
    await page.getByLabel("Senha", { exact: true }).fill(PASSWORD);
    await page.getByRole("button", { name: "Entrar", exact: true }).click();

    // A senha sozinha não basta: falta o segundo fator
    await expect(page).toHaveURL(/\/entrar\/dois-fatores\?next=%2Flancamentos/);
    await expect(page.locator("html[data-hydrated]")).toBeAttached();
    await page.getByLabel("Código do app autenticador").fill(totp(secret ?? ""));
    await page.getByRole("button", { name: "Confirmar" }).click();

    await expect(page).toHaveURL("/lancamentos");
    await expect(page.getByRole("heading", { level: 1, name: "Lançamentos" })).toBeVisible();
  });

  test("senha errada e e-mail inexistente recebem a mesma mensagem", async ({
    page,
    request,
  }, testInfo) => {
    const email = testEmail("senha-errada", testInfo.project.name);
    await createTestUser(request, { email, password: PASSWORD, twoFactor: false });

    for (const tentativa of [email, "ninguem@fintrack.test"]) {
      await openPage(page, "/entrar");
      await page.getByLabel("E-mail").fill(tentativa);
      await page.getByLabel("Senha", { exact: true }).fill("senha errada demais");
      await page.getByRole("button", { name: "Entrar", exact: true }).click();
      await expect(formAlert(page)).toHaveText("E-mail ou senha incorretos.");
      // A senha some e recebe o foco, pronta para digitar de novo
      await expect(page.getByLabel("Senha", { exact: true })).toBeFocused();
      await expect(page.getByLabel("Senha", { exact: true })).toHaveValue("");
    }
  });

  test("dois fatores: abrir sem ter digitado a senha volta para /entrar", async ({ page }) => {
    await page.goto("/entrar/dois-fatores?next=%2Forcamento");
    await expect(page).toHaveURL("/entrar?next=%2Forcamento");
  });

  test("dois fatores: campo vazio ou com letras recebe o aviso na página", async ({
    page,
    request,
  }, testInfo) => {
    const email = testEmail("codigo-formato", testInfo.project.name);
    await createTestUser(request, { email, password: PASSWORD });
    await startTwoFactor(page, email, PASSWORD);

    const campo = page.getByLabel("Código do app autenticador");
    await page.getByRole("button", { name: "Confirmar" }).click();
    await expect(campo).toBeFocused();
    await expect(campo).toHaveAttribute("aria-invalid", "true");
    await expect(page.getByText("Digite o código de 6 números do app.")).toBeVisible();

    // Letras nem entram no campo; com menos de 6 números, o aviso diz o formato
    await campo.pressSequentially("12ab");
    await expect(campo).toHaveValue("12");
    await page.getByRole("button", { name: "Confirmar" }).click();
    await expect(page.getByText("O código tem 6 números.")).toBeVisible();
    await expect(campo).toBeFocused();
  });

  test("dois fatores: o modo backup não fala mais em app autenticador", async ({
    page,
    request,
  }, testInfo) => {
    const email = testEmail("codigo-modo", testInfo.project.name);
    await createTestUser(request, { email, password: PASSWORD });
    await startTwoFactor(page, email, PASSWORD);
    await expect(page.getByText("Falta confirmar que é você.")).toBeVisible();
    await expect(page.getByText("app Senhas do iPhone e do Mac")).toBeVisible();

    await page.getByRole("button", { name: "Usar um código de backup" }).click();
    await expect(page.getByLabel("Código de backup")).toBeFocused();
    await expect(page.getByText(/app autenticador/)).toHaveCount(1); // só o botão de voltar a ele
    await expect(page.getByRole("button", { name: "Usar o app autenticador" })).toBeVisible();
  });

  test("dois fatores: verificação expirada leva o foco ao aviso e ao caminho de volta", async ({
    page,
    request,
  }, testInfo) => {
    const email = testEmail("codigo-expirado", testInfo.project.name);
    const { secret } = await createTestUser(request, { email, password: PASSWORD });
    await startTwoFactor(page, email, PASSWORD);
    // O cookie que liga a senha ao código vale 10 minutos; apagá-lo simula a espera
    await page.context().clearCookies({ name: "fintrack.two_factor" });

    await page.getByLabel("Código do app autenticador").fill(totp(secret ?? ""));
    await page.getByRole("button", { name: "Confirmar" }).click();
    await expect(formAlert(page)).toContainText("A verificação expirou");
    await expect(formAlert(page)).toBeFocused();
    // O campo some: outro código não resolveria. Fica o caminho de volta
    await expect(page.getByLabel("Código do app autenticador")).toHaveCount(0);
    await page.getByRole("link", { name: "Entrar de novo" }).click();
    await expect(page).toHaveURL(/\/entrar(\?|$)/);
  });

  test("formulários avisam na página, em português, e marcam o campo", async ({ page }) => {
    await openPage(page, "/entrar");
    await page.getByRole("button", { name: "Entrar", exact: true }).click();
    const email = page.getByLabel("E-mail");
    await expect(email).toBeFocused();
    await expect(email).toHaveAttribute("aria-invalid", "true");
    await expect(page.getByText("Digite o seu e-mail.")).toBeVisible();
    await expect(page.getByText("Digite a sua senha.")).toBeVisible();
    // O aviso some assim que o campo fica válido
    await email.fill("ana@fintrack.test");
    await expect(page.getByText("Digite o seu e-mail.")).toHaveCount(0);
    await expect(email).not.toHaveAttribute("aria-invalid", "true");

    await openPage(page, "/esqueci-a-senha");
    await expect(
      page.getByText("Vamos mandar um link para você criar uma senha nova."),
    ).toBeVisible();
    await page.getByLabel("E-mail da conta").fill("ana");
    await page.getByRole("button", { name: "Enviar o link" }).click();
    await expect(page.getByText("Digite um e-mail válido, como nome@exemplo.com.")).toBeVisible();
    await expect(page.getByLabel("E-mail da conta")).toBeFocused();
  });

  test("código errado do app não entra", async ({ page, request }, testInfo) => {
    const email = testEmail("codigo-errado", testInfo.project.name);
    await createTestUser(request, { email, password: PASSWORD });

    await openPage(page, "/entrar");
    await page.getByLabel("E-mail").fill(email);
    await page.getByLabel("Senha", { exact: true }).fill(PASSWORD);
    await page.getByRole("button", { name: "Entrar", exact: true }).click();
    await expect(page).toHaveURL(/dois-fatores/);
    await expect(page.locator("html[data-hydrated]")).toBeAttached();
    await page.getByLabel("Código do app autenticador").fill("000000");
    await page.getByRole("button", { name: "Confirmar" }).click();
    await expect(formAlert(page)).toContainText("Código incorreto");
    await expect(page).toHaveURL(/dois-fatores/);
  });

  test("um código de backup entra uma vez só", async ({ page, request }, testInfo) => {
    const email = testEmail("backup", testInfo.project.name);
    const { backupCodes } = await createTestUser(request, { email, password: PASSWORD });
    const code = backupCodes[0] ?? "";

    for (const vez of ["primeira", "segunda"] as const) {
      await page.context().clearCookies();
      await openPage(page, "/entrar");
      await page.getByLabel("E-mail").fill(email);
      await page.getByLabel("Senha", { exact: true }).fill(PASSWORD);
      await page.getByRole("button", { name: "Entrar", exact: true }).click();
      await expect(page).toHaveURL(/dois-fatores/);
      await expect(page.locator("html[data-hydrated]")).toBeAttached();
      await page.getByRole("button", { name: "Usar um código de backup" }).click();
      await expect(page.getByLabel("Código de backup")).toBeFocused();
      await page.getByLabel("Código de backup").fill(code);
      await page.getByRole("button", { name: "Confirmar" }).click();
      if (vez === "primeira") {
        await expect(page.getByRole("heading", { level: 1, name: "Início" })).toBeVisible();
      } else {
        await expect(formAlert(page)).toContainText("já usado");
      }
    }
  });

  test("muitas senhas erradas seguidas bloqueiam por um minuto", async ({ page }) => {
    await openPage(page, "/entrar");
    for (let i = 1; i <= 6; i++) {
      await page.getByLabel("E-mail").fill("alguem@fintrack.test");
      await page.getByLabel("Senha", { exact: true }).fill(`errada ${i}`);
      await page.getByRole("button", { name: "Entrar", exact: true }).click();
      await expect(formAlert(page)).toBeVisible();
      if (i < 6) await expect(formAlert(page)).toHaveText("E-mail ou senha incorretos.");
    }
    await expect(formAlert(page)).toContainText("Muitas tentativas");
  });

  test("cadastro fora da lista não cria conta nem envia e-mail", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "fluxo de cadastro: um aparelho basta");
    const email = "intruso@fintrack.test";
    await clearEmails(email);
    await openPage(page, "/cadastro");
    await page.getByLabel("Nome").fill("Intruso");
    await page.getByLabel("E-mail").fill(email);
    await page.getByLabel("Senha", { exact: true }).fill(PASSWORD);
    await page.getByRole("button", { name: "Criar conta" }).click();

    // A tela é a mesma de um cadastro normal: não revela quem está na lista...
    await expect(
      page.getByRole("heading", { level: 1, name: "Confirme seu e-mail" }),
    ).toBeVisible();
    // ...mas nenhuma conta foi criada e nenhum e-mail saiu
    expect(await sql('SELECT id FROM "user" WHERE email = $1', [email])).toHaveLength(0);
    await page.waitForTimeout(1_000);
    expect(await countEmails(email)).toBe(0);
  });

  test("cadastro completo: confirmar o e-mail, ligar o 2FA e guardar os códigos", async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "fluxo de cadastro: um aparelho basta");
    const email = "bruno@fintrack.test"; // está na lista ALLOWED_EMAILS
    await sql('DELETE FROM "user" WHERE email = $1', [email]);
    await clearEmails(email);

    await openPage(page, "/cadastro");
    await page.getByLabel("Nome").fill("Bruno Teste");
    await page.getByLabel("E-mail").fill(email);
    await page.getByLabel("Senha", { exact: true }).fill(PASSWORD);
    await page.getByRole("button", { name: "Criar conta" }).click();
    await expect(
      page.getByRole("heading", { level: 1, name: "Confirme seu e-mail" }),
    ).toBeVisible();

    // O link do e-mail confirma a conta, abre a sessão e leva à configuração do 2FA
    await page.goto(await linkFromEmail(email, /Confirme seu e-mail/));
    await expect(page).toHaveURL("/configurar-2fa");

    // Sem 2FA, nenhuma outra página abre
    await page.goto("/lancamentos");
    await expect(page).toHaveURL("/configurar-2fa");
    await expect(page.locator("html[data-hydrated]")).toBeAttached();

    await page.getByLabel("Confirme sua senha").fill(PASSWORD);
    await page.getByRole("button", { name: "Continuar" }).click();
    await expect(page.getByRole("heading", { name: "Passo 2 de 3: ler o QR code" })).toBeFocused();
    await expect(page.getByRole("img", { name: /QR code/ })).toBeVisible();
    await page.getByText("Não consegue ler? Digite a chave").click();
    const secret = (await page.getByTestId("totp-secret").textContent()) ?? "";
    await page.getByLabel(/Código de 6 números/).fill(totp(secret));
    await page.getByRole("button", { name: "Ligar o 2FA" }).click();

    await expect(page.getByRole("heading", { name: /Passo 3 de 3/ })).toBeFocused();
    await expect(
      page.getByRole("list", { name: "Códigos de backup" }).getByRole("listitem"),
    ).toHaveCount(10);
    const continuar = page.getByRole("button", { name: "Ir para o FinTrack" });
    await expect(continuar).toBeDisabled();
    await page.getByLabel("Guardei os códigos em um lugar seguro").check();
    await continuar.click();

    await expect(page.getByRole("heading", { level: 1, name: "Início" })).toBeVisible();
    await expect(page.getByText("Olá, Bruno.")).toBeVisible();
  });

  test("esqueci a senha: o link do e-mail troca a senha e derruba as sessões", async ({
    page,
    request,
  }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "fluxo por e-mail: um aparelho basta");
    const email = testEmail("esqueci", testInfo.project.name);
    const { secret } = await createTestUser(request, { email, password: PASSWORD });
    await clearEmails(email);
    const antes = await sql(
      'SELECT id FROM session WHERE "userId" = (SELECT id FROM "user" WHERE email = $1)',
      [email],
    );
    expect(antes.length).toBeGreaterThan(0); // a sessão aberta pelo createTestUser

    await openPage(page, "/esqueci-a-senha");
    await page.getByLabel("E-mail da conta").fill(email);
    await page.getByRole("button", { name: "Enviar o link" }).click();
    await expect(formAlert(page)).toContainText("Se houver uma conta com este e-mail");

    await page.goto(await linkFromEmail(email, /Troca de senha/));
    await expect(page).toHaveURL(/\/redefinir-senha\?token=/);
    await expect(page.locator("html[data-hydrated]")).toBeAttached();
    const nova = "outra frase longa e nova";
    await page.getByLabel("Nova senha").fill(nova);
    await page.getByRole("button", { name: "Salvar a nova senha" }).click();
    await expect(page).toHaveURL("/entrar?aviso=senha-trocada");
    await expect(formAlert(page)).toHaveText("Senha trocada. Entre com a senha nova.");

    // Todas as sessões da conta caíram
    const depois = await sql(
      'SELECT id FROM session WHERE "userId" = (SELECT id FROM "user" WHERE email = $1)',
      [email],
    );
    expect(depois).toHaveLength(0);

    await signInThroughUi(page, email, nova, secret ?? "");
    await expect(page.getByRole("heading", { level: 1, name: "Início" })).toBeVisible();
  });
});

test.describe("com sessão própria", () => {
  test.use({ storageState: NO_SESSION });

  test("sair apaga a sessão e fecha o app", async ({ page, request }, testInfo) => {
    const email = testEmail("sair", testInfo.project.name);
    const { secret } = await createTestUser(request, { email, password: PASSWORD });
    await signInThroughUi(page, email, PASSWORD, secret ?? "");
    await expect(page.getByRole("heading", { level: 1, name: "Início" })).toBeVisible();

    await openPage(page, "/ajustes");
    await page.getByRole("button", { name: "Sair" }).click();
    await expect(page).toHaveURL("/entrar");
    await page.goto("/ajustes");
    await expect(page).toHaveURL("/entrar?next=%2Fajustes");
  });

  test("trocar a senha: confere a atual, avisa por e-mail e derruba os outros aparelhos", async ({
    page,
    browser,
    request,
  }, testInfo) => {
    const email = testEmail("trocar-senha", testInfo.project.name);
    const { secret } = await createTestUser(request, { email, password: PASSWORD });
    await sql('DELETE FROM session WHERE "userId" = (SELECT id FROM "user" WHERE email = $1)', [
      email,
    ]);
    await clearEmails(email);

    // "Outro aparelho" logado, que deve cair depois da troca
    const outro = await browser.newContext({ storageState: NO_SESSION });
    const outroPage = await outro.newPage();
    await signInThroughUi(outroPage, email, PASSWORD, secret ?? "");
    await expect(outroPage.getByRole("heading", { level: 1, name: "Início" })).toBeVisible();

    await signInThroughUi(page, email, PASSWORD, secret ?? "");
    await expect(page.getByRole("heading", { level: 1, name: "Início" })).toBeVisible();
    await openPage(page, "/ajustes/seguranca");
    const senhaAtual = page.getByLabel("Senha atual");
    const senhaNova = page.getByLabel("Senha nova");
    const trocar = page.getByRole("button", { name: "Trocar a senha" });

    // 1. Senha atual errada: avisa e devolve o foco para o campo da senha atual
    await senhaAtual.fill("nao e a minha senha");
    await senhaNova.fill("uma frase nova bem comprida");
    await trocar.click();
    await expect(formAlert(page)).toHaveText("A senha atual não confere.");
    await expect(senhaAtual).toBeFocused();

    // 2. Mesma senha: nem chama o servidor
    await senhaAtual.fill(PASSWORD);
    await senhaNova.fill(PASSWORD);
    await trocar.click();
    await expect(formAlert(page)).toHaveText("A senha nova precisa ser diferente da atual.");
    await expect(senhaNova).toBeFocused();

    // 3. Tudo certo: troca, limpa os campos e encerra o outro aparelho
    const nova = "uma frase nova bem comprida";
    await senhaNova.fill(nova);
    await trocar.click();
    await expect(page.getByRole("status").filter({ hasText: "Senha trocada" })).toHaveText(
      "Senha trocada. As sessões nos outros aparelhos foram encerradas.",
    );
    await expect(senhaAtual).toHaveValue("");
    await expect(
      page.getByRole("region", { name: "Sessões ativas" }).getByRole("listitem"),
    ).toHaveCount(1);

    // Este aparelho continua logado; o outro caiu
    await page.reload();
    await expect(page.getByRole("heading", { level: 1, name: "Segurança" })).toBeVisible();
    await outroPage.goto("/lancamentos");
    await expect(outroPage).toHaveURL("/entrar?next=%2Flancamentos");

    // O aviso chegou e aponta para o "esqueci a senha", caso não tenha sido a pessoa
    const link = await linkFromEmail(email, /Sua senha do FinTrack foi trocada/);
    expect(link).toMatch(/\/esqueci-a-senha$/);

    // A senha nova vale; a antiga não
    await signInThroughUi(outroPage, email, nova, secret ?? "");
    await expect(outroPage.getByRole("heading", { level: 1, name: "Início" })).toBeVisible();
    await outro.close();
    const antiga = await request.post("/api/auth/sign-in/email", {
      headers: apiHeaders(fakeIp()),
      data: { email, password: PASSWORD },
    });
    expect(antiga.status()).toBe(401);
  });

  test("trocar a senha: chutes seguidos da senha atual são barrados", async ({
    page,
    request,
  }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "limite do servidor: um aparelho basta");
    const email = testEmail("trocar-senha-limite", testInfo.project.name);
    const { secret } = await createTestUser(request, { email, password: PASSWORD });
    await signInThroughUi(page, email, PASSWORD, secret ?? "");
    await expect(page.getByRole("heading", { level: 1, name: "Início" })).toBeVisible();
    await openPage(page, "/ajustes/seguranca");

    // O limite do auth.ts é de 5 por minuto: as 5 primeiras são conferidas (e recusadas),
    // a 6ª é barrada antes de conferir a senha. (O padrão do Better Auth seria 3 a cada 10 s,
    // que deixa passar 18 por minuto; se a regra sumir do auth.ts, a 4ª já falha aqui.)
    const alerta = formAlert(page);
    for (let i = 1; i <= 6; i++) {
      await page.getByLabel("Senha atual").fill(`chute numero ${i} errado`);
      await page.getByLabel("Senha nova").fill("uma frase nova bem comprida");
      // Espera a resposta do servidor desta tentativa: o aviso da anterior tem o mesmo texto
      const [resposta] = await Promise.all([
        page.waitForResponse((r) => r.url().endsWith("/api/auth/change-password")),
        page.getByRole("button", { name: "Trocar a senha" }).click(),
      ]);
      expect(resposta.status(), `tentativa ${i}`).toBe(i <= 5 ? 400 : 429);
    }
    await expect(alerta).toHaveText(
      "Muitas tentativas em pouco tempo. Espere um minuto e tente de novo.",
    );

    // E a senha continua a mesma (outro IP, para não cair no limite do login)
    const login = await request.post("/api/auth/sign-in/email", {
      headers: apiHeaders(fakeIp()),
      data: { email, password: PASSWORD },
    });
    expect(login.status()).toBe(200);
  });

  test("encerrar a sessão de outro aparelho derruba esse aparelho", async ({
    page,
    browser,
    request,
  }, testInfo) => {
    const email = testEmail("sessoes", testInfo.project.name);
    const { secret } = await createTestUser(request, { email, password: PASSWORD });
    await sql('DELETE FROM session WHERE "userId" = (SELECT id FROM "user" WHERE email = $1)', [
      email,
    ]);

    // "Outro aparelho": um navegador separado, com cookies próprios
    const outro = await browser.newContext({ storageState: NO_SESSION });
    const outroPage = await outro.newPage();
    await signInThroughUi(outroPage, email, PASSWORD, secret ?? "");
    await expect(outroPage.getByRole("heading", { level: 1, name: "Início" })).toBeVisible();

    await signInThroughUi(page, email, PASSWORD, secret ?? "");
    await expect(page.getByRole("heading", { level: 1, name: "Início" })).toBeVisible();

    await openPage(page, "/ajustes/seguranca");
    const lista = page.getByRole("region", { name: "Sessões ativas" }).getByRole("listitem");
    await expect(lista).toHaveCount(2);
    await expect(lista.filter({ hasText: "este aparelho" })).toHaveCount(1);
    await page.getByRole("button", { name: /^Encerrar a sessão de/ }).click();
    await expect(lista).toHaveCount(1);

    await outroPage.goto("/lancamentos");
    await expect(outroPage).toHaveURL("/entrar?next=%2Flancamentos");
    await outro.close();
  });

  test("ação sensível com login antigo pede reautenticação", async ({
    page,
    request,
  }, testInfo) => {
    const email = testEmail("reauth", testInfo.project.name);
    const { secret } = await createTestUser(request, { email, password: PASSWORD });
    await signInThroughUi(page, email, PASSWORD, secret ?? "");
    await expect(page.getByRole("heading", { level: 1, name: "Início" })).toBeVisible();
    await ageSessions(email, 60); // o login "aconteceu" há 1 hora

    await openPage(page, "/ajustes/seguranca");
    await page.getByRole("button", { name: "Adicionar passkey" }).click();
    await expect(page).toHaveURL("/reautenticar?next=%2Fajustes%2Fseguranca");
    await expect(page.locator("html[data-hydrated]")).toBeAttached();

    await page.getByLabel("Senha", { exact: true }).fill("senha errada demais");
    await page.getByRole("button", { name: "Confirmar", exact: true }).click();
    await expect(formAlert(page)).toHaveText("Senha incorreta.");

    await page.getByRole("button", { name: "Usar o código do app" }).click();
    await page.getByLabel("Código do app autenticador").fill(totp(secret ?? ""));
    await page.getByRole("button", { name: "Confirmar", exact: true }).click();
    await expect(page).toHaveURL("/ajustes/seguranca");
    const [row] = await sql<{ reauthenticatedAt: Date | null }>(
      `SELECT "reauthenticatedAt" FROM session WHERE "userId" = (SELECT id FROM "user" WHERE email = $1)
       ORDER BY "reauthenticatedAt" DESC NULLS LAST`,
      [email],
    );
    expect(row?.reauthenticatedAt).not.toBeNull();
  });

  test("a API recusa a ação sensível sem prova recente, mesmo chamada direto", async ({
    request,
  }, testInfo) => {
    const email = testEmail("reauth-api", testInfo.project.name);
    await createTestUser(request, { email, password: PASSWORD });
    const headers = apiHeaders(fakeIp());

    // Login de agora: pode
    const fresh = await request.get("/api/auth/passkey/generate-register-options", { headers });
    expect(fresh.status()).toBe(200);

    // Login de 1 hora atrás: o hook do auth.ts recusa
    await ageSessions(email, 60);
    const old = await request.get("/api/auth/passkey/generate-register-options", { headers });
    expect(old.status()).toBe(403);
    expect(((await old.json()) as { code: string }).code).toBe("REAUTH_REQUIRED");
  });

  test("passkey: navegador sem passkey avisa em vez de ficar em silêncio", async ({
    page,
    request,
  }, testInfo) => {
    // É o que acontece no celular pelo http://192.168.1.92:3000: fora de https e de localhost,
    // o navegador não oferece passkeys. Aqui, apagar o PublicKeyCredential simula o mesmo efeito.
    await page.addInitScript(() => {
      // @ts-expect-error -- de propósito: simula um navegador sem WebAuthn
      delete window.PublicKeyCredential;
    });

    await openPage(page, "/entrar");
    await page.getByRole("button", { name: "Entrar com passkey" }).click();
    await expect(formAlert(page)).toContainText("Este navegador não oferece passkeys");
    await expect(formAlert(page)).toContainText("e-mail, senha e o código do app");

    // Na tela de Segurança, o botão de adicionar também explica
    const email = testEmail("passkey-sem-suporte", testInfo.project.name);
    const { secret } = await createTestUser(request, { email, password: PASSWORD });
    await signInThroughUi(page, email, PASSWORD, secret ?? "");
    await expect(page.getByRole("heading", { level: 1, name: "Início" })).toBeVisible();
    await openPage(page, "/ajustes/seguranca");
    await page.getByRole("button", { name: "Adicionar passkey" }).click();
    await expect(formAlert(page)).toContainText("Este navegador não oferece passkeys");
    await expect(page.getByRole("region", { name: "Passkeys" }).getByRole("listitem")).toHaveCount(
      0,
    );
  });

  test("passkey: cadastrar e depois entrar sem senha", async ({ page, request }, testInfo) => {
    const email = testEmail("passkey", testInfo.project.name);
    const { secret } = await createTestUser(request, { email, password: PASSWORD });

    // Um autenticador virtual do Chromium faz o papel da digital do celular
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("WebAuthn.enable");
    await cdp.send("WebAuthn.addVirtualAuthenticator", {
      options: {
        protocol: "ctap2",
        transport: "internal",
        hasResidentKey: true,
        hasUserVerification: true,
        isUserVerified: true,
      },
    });

    await signInThroughUi(page, email, PASSWORD, secret ?? "");
    await expect(page.getByRole("heading", { level: 1, name: "Início" })).toBeVisible();
    await openPage(page, "/ajustes/seguranca");
    await page.getByRole("button", { name: "Adicionar passkey" }).click();
    const passkeys = page.getByRole("region", { name: "Passkeys" }).getByRole("listitem");
    await expect(passkeys).toHaveCount(1);

    // O autenticador virtual aprova sozinho a sugestão automática de passkey do campo de e-mail
    // (conditional UI), e às vezes entrava antes do clique. Desligada aqui, o teste usa o botão.
    await page.addInitScript(() => {
      Object.defineProperty(PublicKeyCredential, "isConditionalMediationAvailable", {
        value: () => Promise.resolve(false),
      });
    });
    await openPage(page, "/ajustes");
    await page.getByRole("button", { name: "Sair" }).click();
    await expect(page).toHaveURL("/entrar");
    await expect(page.locator("html[data-hydrated]")).toBeAttached();
    await page.getByRole("button", { name: "Entrar com passkey" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Início" })).toBeVisible();
  });
});
