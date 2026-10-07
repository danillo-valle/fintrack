// Permissões de ponta a ponta (M06): o que cada pessoa vê e faz, pelo navegador.
//
//   1. IDOR: abrir a URL da carteira de outra pessoa dá 404 (a mesma resposta de "não existe").
//   2. O convite pelas telas: criar o lar, convidar, aceitar pelo link (uso único).
//   3. Papéis na tela: o leitor não vê os controles de dono; o último dono não sai.
//
// Os testes de integração (packages/db) já provam cada linha da matriz contra o banco. Aqui o
// foco é a ligação: URL → página → crachá → 404, e formulário → action → regra → mensagem.
import { expect, type Browser, type Page } from "@playwright/test";
import {
  ANA_HOUSEHOLD,
  clearEmails,
  createHouseholdDirect,
  createTestUser,
  deleteHouseholds,
  expectNoA11yViolations,
  linkFromEmail,
  openPage,
  sql,
  test,
  testEmail,
} from "./helpers";

const PASSWORD = "frase longa para testar permissoes";

/** Lares criados por cada teste, apagados no fim (carteiras e convites vão junto). */
const created: string[] = [];
test.afterEach(async () => {
  await deleteHouseholds(created.splice(0));
});

/** Uma pessoa nova, com 2FA, já logada numa aba própria (contexto isolado de cookies). */
async function personInNewTab(browser: Browser, email: string, name: string) {
  const context = await browser.newContext({ locale: "pt-BR", timezoneId: "America/Sao_Paulo" });
  const page = await context.newPage();
  await context.setExtraHTTPHeaders({
    "X-Forwarded-For": `10.66.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`,
  });
  await createTestUser(page.request, { email, password: PASSWORD, name, twoFactor: true });
  return { page, close: () => context.close() };
}

/**
 * A página 404 do app, sem nada da carteira no HTML. Devolve o texto visível da página, para
 * comparar: "não é sua" e "não existe" precisam ser indistinguíveis.
 *
 * Sobre o status HTTP: com o loading.tsx do grupo (app), o Next.js já enviou o começo da
 * resposta (status 200) quando a página chama notFound(); ele então marca a página com
 * <meta name="robots" content="noindex">. O que protege é o conteúdo, conferido aqui (ADR-006).
 */
async function expectNotFoundPage(page: Page, path: string): Promise<string> {
  await openPage(page, path);
  await expect(page.getByText("Esta página não existe")).toBeVisible();
  // (o Next pode inserir a tag mais de uma vez; basta existir)
  await expect(page.locator('meta[name="robots"][content="noindex"]').first()).toBeAttached();
  const html = await page.content();
  // Nada da carteira vaza para o HTML (nem o nome, nem os participantes, nem no payload do React)
  expect(html).not.toContain("Casa da Ana");
  expect(html).not.toContain(ANA_HOUSEHOLD.partner.name);
  await expectNoA11yViolations(page);
  return page.locator("main").innerText();
}

test.describe("IDOR: carteira de outra pessoa responde 404", () => {
  test("pessoa de OUTRO lar abre as carteiras da Ana pela URL", async ({ browser }, testInfo) => {
    const email = testEmail("idor-vizinha", testInfo.project.name);
    const neighbor = await personInNewTab(browser, email, "Vizinha");
    const { householdId } = await createHouseholdDirect({
      name: "Lar da vizinha",
      people: [{ email, role: "OWNER" }],
    });
    created.push(householdId);

    await expectNotFoundPage(neighbor.page, `/carteiras/${ANA_HOUSEHOLD.personalWalletId}`);
    await expectNotFoundPage(neighbor.page, `/carteiras/${ANA_HOUSEHOLD.sharedWalletId}`);
    // E a lista dela não mostra nada da Ana
    await openPage(neighbor.page, "/carteiras");
    await expect(neighbor.page.getByRole("link", { name: /Casa da Ana/ })).toHaveCount(0);
    await neighbor.close();
  });

  test("do MESMO lar: a Ana não abre a carteira pessoal da parceira", async ({ page }) => {
    await expectNotFoundPage(page, `/carteiras/${ANA_HOUSEHOLD.partnerWalletId}`);
  });

  test("carteira de outra pessoa, id que não existe e id fora do formato: a MESMA página", async ({
    page,
  }) => {
    const foreign = await expectNotFoundPage(page, `/carteiras/${ANA_HOUSEHOLD.partnerWalletId}`);
    const missing = await expectNotFoundPage(
      page,
      "/carteiras/0199b5c2-7d0e-7a3b-8c1d-2e3f4a5b6c7d",
    );
    const malformed = await expectNotFoundPage(page, "/carteiras/nao-e-um-id");
    expect(missing).toBe(foreign);
    expect(malformed).toBe(foreign);
  });

  test("a Ana abre as próprias carteiras normalmente", async ({ page }) => {
    await openPage(page, `/carteiras/${ANA_HOUSEHOLD.sharedWalletId}`);
    await expect(page.getByRole("heading", { level: 1, name: "Casa da Ana" })).toBeVisible();
    await expect(page.getByText(ANA_HOUSEHOLD.partner.name, { exact: true })).toBeVisible();
  });
});

test.describe("convite pelas telas", () => {
  test("criar o lar, convidar, aceitar pelo link; o link não serve duas vezes", async ({
    browser,
  }, testInfo) => {
    test.slow(); // duas pessoas, e-mail e várias telas
    const ownerEmail = testEmail("convite-dona", testInfo.project.name);
    const guestEmail = testEmail("convite-convidada", testInfo.project.name);
    const owner = await personInNewTab(browser, ownerEmail, "Dona do Teste");
    const guest = await personInNewTab(browser, guestEmail, "Convidada do Teste");
    await clearEmails(guestEmail);

    // 1. A dona cria o lar pela tela
    await openPage(owner.page, "/ajustes/lar");
    await owner.page.getByLabel("Nome do lar").fill("Lar do Teste E2E");
    await owner.page.getByRole("button", { name: "Criar meu lar" }).click();
    await expect(
      owner.page.getByRole("heading", { level: 1, name: "Lar do Teste E2E" }),
    ).toBeVisible();
    created.push(await householdIdOf(ownerEmail));

    // 2. Convida: o link aparece UMA vez na tela e chega por e-mail
    await owner.page.getByLabel("E-mail de quem você quer convidar").fill(guestEmail);
    await owner.page.getByRole("button", { name: "Enviar convite" }).click();
    await expect(owner.page.getByText(`Convite enviado para ${guestEmail}`)).toBeVisible();
    const shownLink = await owner.page
      .getByLabel("Link do convite (mostrado só agora)")
      .inputValue();
    const emailedLink = await linkFromEmail(guestEmail, /convidou você/);
    expect(emailedLink).toBe(shownLink);
    const invitePath = new URL(shownLink).pathname;

    // 3. A convidada abre o link, vê o convite e aceita
    await openPage(guest.page, invitePath);
    await expect(guest.page.getByRole("heading", { name: "Lar do Teste E2E" })).toBeVisible();
    await expectNoA11yViolations(guest.page);
    await guest.page.getByRole("button", { name: "Aceitar convite" }).click();
    await expect(guest.page).toHaveURL(/\/carteiras$/);
    await expect(guest.page.getByRole("link", { name: /Pessoal/ })).toBeVisible();

    // 4. O mesmo link, de novo: não vale mais
    await openPage(guest.page, invitePath);
    await expect(guest.page.getByText("Não dá para aceitar este convite")).toBeVisible();
    await expect(guest.page.getByText(/já foi usado/)).toBeVisible();

    // 5. A dona vê a convidada no lar e o evento na atividade
    await openPage(owner.page, "/ajustes/lar");
    await expect(
      owner.page.getByRole("region", { name: "Pessoas" }).getByText("Convidada do Teste"),
    ).toBeVisible();
    await expect(owner.page.getByText("aceitou o convite e entrou no lar")).toBeVisible();

    await owner.close();
    await guest.close();
  });

  test("outra conta com o link do convite não consegue aceitar", async ({ browser }, testInfo) => {
    const ownerEmail = testEmail("convite2-dona", testInfo.project.name);
    const guestEmail = testEmail("convite2-certa", testInfo.project.name);
    const intruderEmail = testEmail("convite2-intrusa", testInfo.project.name);
    const owner = await personInNewTab(browser, ownerEmail, "Dona 2");
    const intruder = await personInNewTab(browser, intruderEmail, "Intrusa");
    created.push(
      (
        await createHouseholdDirect({
          name: "Lar 2",
          people: [{ email: ownerEmail, role: "OWNER" }],
        })
      ).householdId,
    );

    await openPage(owner.page, "/ajustes/lar");
    await owner.page.getByLabel("E-mail de quem você quer convidar").fill(guestEmail);
    await owner.page.getByRole("button", { name: "Enviar convite" }).click();
    const link = await owner.page.getByLabel("Link do convite (mostrado só agora)").inputValue();

    await openPage(intruder.page, new URL(link).pathname);
    await expect(intruder.page.getByText(/foi enviado para outro e-mail/)).toBeVisible();
    await expect(intruder.page.getByRole("button", { name: "Aceitar convite" })).toHaveCount(0);

    await owner.close();
    await intruder.close();
  });
});

test.describe("papéis na tela da carteira", () => {
  test("leitor vê a carteira sem os controles de dono; o dono troca o papel", async ({
    browser,
  }, testInfo) => {
    const ownerEmail = testEmail("papel-dono", testInfo.project.name);
    const readerEmail = testEmail("papel-leitor", testInfo.project.name);
    const owner = await personInNewTab(browser, ownerEmail, "Dono Papel");
    const reader = await personInNewTab(browser, readerEmail, "Leitor Papel");
    const { householdId, shared } = await createHouseholdDirect({
      name: "Lar dos papéis",
      people: [
        { email: ownerEmail, role: "OWNER" },
        { email: readerEmail, role: "MEMBER" },
      ],
      shared: [
        {
          name: "Mercado",
          members: [
            { email: ownerEmail, role: "OWNER" },
            { email: readerEmail, role: "VIEWER" },
          ],
        },
      ],
    });
    created.push(householdId);
    const walletPath = `/carteiras/${shared["Mercado"]}`;

    // Leitor: vê quem participa, não vê renomear nem trocar papel; pode sair
    await openPage(reader.page, walletPath);
    await expect(reader.page.getByRole("heading", { level: 1, name: "Mercado" })).toBeVisible();
    await expect(reader.page.getByText(/você é leitor/)).toBeVisible();
    await expect(reader.page.getByRole("heading", { name: "Renomear" })).toHaveCount(0);
    await expect(reader.page.getByLabel(/Papel de/)).toHaveCount(0);
    await expect(reader.page.getByRole("button", { name: "Sair da carteira" })).toBeVisible();
    await expectNoA11yViolations(reader.page);

    // Dono: promove o leitor a editor
    await openPage(owner.page, walletPath);
    await owner.page.getByLabel("Papel de Leitor Papel", { exact: true }).selectOption("EDITOR");
    await owner.page.getByRole("button", { name: "Salvar o papel de Leitor Papel" }).click();
    await expect(owner.page.getByText("Papel atualizado.")).toBeVisible();

    // O dono tenta se rebaixar sendo o único dono: a regra recusa e explica
    await owner.page.getByLabel("Papel de Dono Papel", { exact: true }).selectOption("VIEWER");
    await owner.page.getByRole("button", { name: "Salvar o papel de Dono Papel" }).click();
    await expect(owner.page.getByText(/precisa de pelo menos um dono/)).toBeVisible();

    // O leitor (agora editor) recarrega e vê o papel novo
    await openPage(reader.page, walletPath);
    await expect(reader.page.getByText(/você é editor/)).toBeVisible();

    await owner.close();
    await reader.close();
  });

  test("criar carteira compartilhada pela tela e ver a auditoria", async ({ page }) => {
    // A Ana é dona do lar dela: cria uma carteira com a parceira como leitora e depois a arquiva
    await openPage(page, "/carteiras/nova");
    const name = `Viagem ${test.info().project.name} ${Date.now()}`;
    await page.getByLabel("Nome da carteira").fill(name);
    await page
      .getByLabel(`Papel de ${ANA_HOUSEHOLD.partner.name}`, { exact: true })
      .selectOption("VIEWER");
    await page.getByRole("button", { name: "Criar carteira" }).click();
    await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
    await expect(page.getByText(ANA_HOUSEHOLD.partner.name, { exact: true })).toBeVisible();

    // Arquiva (com confirmação) para não poluir a lista dos outros testes
    await page.getByRole("button", { name: "Arquivar" }).click();
    await page.getByRole("button", { name: "Sim, arquivar" }).click();
    await expect(page.getByText("Carteira arquivada.")).toBeVisible();

    await openPage(page, "/ajustes/lar");
    await expect(page.getByText("arquivou uma carteira").first()).toBeVisible();
  });
});

/** O lar de uma pessoa (pelo banco), para o teste apagar no fim. */
async function householdIdOf(email: string): Promise<string> {
  const [row] = await sql<{ householdId: string }>(
    `SELECT "householdId" FROM household_member m JOIN "user" u ON u.id = m."userId" WHERE u.email = $1`,
    [email],
  );
  return row?.householdId ?? "";
}
