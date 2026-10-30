// Contas e cartões (M12.3a, pranchas J-Contas, J-NovaConta e J-AdicionarCartao), nos dois
// aparelhos. As duas pendências que a Nelcimara achou no uso:
//
//   1. "Conta criada." aparecia no pé da página e ela criou a mesma conta de novo: agora a conta
//      nasce num modal, a tela volta com o aviso no topo e a linha marcada.
//   2. O cadastro do cartão era um <details> "Novo cartão em …" que ela não achou: agora toda
//      conta de cartão (ou vale) tem o botão "Adicionar cartão", que abre um modal.
//
// E o de sempre: a URL do cartão de uma conta de outra pessoa responde a 404 sem nenhum dado.
// Dados sintéticos (finais 0001 e 0002).
import { expect } from "@playwright/test";
import {
  createHouseholdDirect,
  createTestUser,
  deleteHouseholds,
  expectNoA11yViolations,
  openPage,
  pageData,
  serverAction,
  clickAndWait,
  personInNewTab,
  sql,
  test,
  testEmail,
  waitForReady,
} from "./helpers";

const PASSWORD = "frase longa de quem cuida das contas";

const created: string[] = [];
test.afterEach(async () => {
  await deleteHouseholds(created.splice(0));
});

test("nova conta em modal, o aviso no topo, a linha marcada e o Adicionar cartão", async ({
  page,
}, testInfo) => {
  test.slow(); // três telas e dois modais (no pnpm dev, cada um compila na primeira visita)
  const email = testEmail("contas", testInfo.project.name);
  await createTestUser(page.request, { email, password: PASSWORD, name: "Lia", twoFactor: true });
  const { householdId, personal } = await createHouseholdDirect({
    name: "Lar das contas",
    people: [{ email, role: "OWNER" }],
  });
  created.push(householdId);
  const walletId = personal[email]!;
  const [wallet] = await sql<{ name: string }>(`SELECT name FROM wallet WHERE id = $1`, [walletId]);

  // 1. "Nova conta" no cabeçalho abre o modal (a lista continua atrás)
  await openPage(page, "/ajustes/contas");
  await clickAndWait(
    page.getByRole("link", { name: "Nova conta" }),
    pageData("/ajustes/contas/nova"),
  );
  const dialog = page.getByRole("dialog", { name: "Nova conta" });
  await expect(dialog).toBeVisible();
  await waitForReady(page);
  await dialog.getByLabel("Nome da conta").fill("Cartão Exemplo");
  await dialog.getByLabel("Tipo").selectOption("CREDIT_CARD");
  await dialog.getByLabel("Fecha no dia").fill("1");
  await dialog.getByLabel("Vence no dia").fill("10");
  await clickAndWait(page.getByRole("button", { name: "Criar conta" }), serverAction);

  // 2. A tela volta com o aviso no topo, a linha marcada e o caminho para o cartão
  await page.waitForURL(/\/ajustes\/contas\?criada=/);
  await waitForReady(page);
  await expect(dialog).toBeHidden();
  const notice = page.getByTestId("aviso-criado").filter({ visible: true });
  await expect(notice).toContainText(`Conta “Cartão Exemplo” criada em ${wallet!.name}.`);
  await expect(notice).toContainText("Agora cadastre o cartão.");
  // O aviso é o primeiro conteúdo depois do cabeçalho: à vista sem rolar
  await expect(notice).toBeInViewport();
  const row = page.locator("li[data-nova=true]").filter({ visible: true });
  await expect(row).toContainText("Cartão Exemplo");
  await expect(row).toContainText("Ainda sem cartão.");
  await expectNoA11yViolations(page);
  const [account] = await sql<{ id: string; n: string }>(
    `SELECT id, (SELECT count(*)::text FROM financial_account WHERE "walletId" = $1) AS n
       FROM financial_account WHERE "walletId" = $1 AND name = 'Cartão Exemplo'`,
    [walletId],
  );
  expect(account!.n).toBe("1");

  // 3. "Adicionar cartão" do aviso abre o modal com o nome da conta em cima
  await clickAndWait(
    notice.getByRole("link", { name: "Adicionar cartão" }),
    pageData(`/ajustes/contas/${account!.id}/cartao`),
  );
  const cardDialog = page.getByRole("dialog", { name: "Adicionar cartão" });
  await expect(cardDialog).toBeVisible();
  await expect(cardDialog).toContainText("Cartão Exemplo");
  await waitForReady(page);
  await expect(cardDialog.getByLabel("Final")).toHaveAttribute("maxlength", "4");
  await cardDialog.getByLabel("Apelido").fill("Exemplo da Lia");
  await cardDialog.getByLabel("Bandeira").fill("Visa");
  await cardDialog.getByLabel("Final").fill("0001");
  await expectNoA11yViolations(page);
  await clickAndWait(page.getByRole("button", { name: "Adicionar cartão" }), serverAction);

  // 4. Volta com o aviso do cartão, e o cartão aparece na conta
  await page.waitForURL(/\/ajustes\/contas\?cartao=/);
  await waitForReady(page);
  await expect(page.getByTestId("aviso-criado").filter({ visible: true })).toContainText(
    "Cartão “Exemplo da Lia” cadastrado em Cartão Exemplo.",
  );
  // M13.1: o cartão é uma peça com o apelido, a bandeira e o final
  const tile = page
    .getByRole("list", { name: "Cartões de Cartão Exemplo" })
    .filter({ visible: true })
    .getByRole("listitem");
  await expect(tile).toContainText("Exemplo da Lia");
  await expect(tile).toContainText("Visa ···· 0001");
  const [card] = await sql<{ lastFour: string }>(
    `SELECT "lastFour" FROM payment_card WHERE "accountId" = $1`,
    [account!.id],
  );
  expect(card).toEqual({ lastFour: "0001" });

  // 5. Fechar o aviso é um link: a lista volta sem ele
  await page.getByRole("link", { name: "Fechar o aviso" }).filter({ visible: true }).click();
  await page.waitForURL(/\/ajustes\/contas$/);
  await expect(page.getByTestId("aviso-criado").filter({ visible: true })).toHaveCount(0);
});

test("a página da conta também adiciona cartão e volta para ela", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "mesmo formulário do outro teste");
  const email = testEmail("contas-conta", testInfo.project.name);
  await createTestUser(page.request, { email, password: PASSWORD, name: "Lia", twoFactor: true });
  const { householdId, personal } = await createHouseholdDirect({
    name: "Lar da conta",
    people: [{ email, role: "OWNER" }],
  });
  created.push(householdId);
  const [account] = await sql<{ id: string }>(
    `INSERT INTO financial_account (id, "householdId", "walletId", "holderId", name, kind, "closingDay", "dueDay", "updatedAt")
     VALUES (gen_random_uuid(), $1, $2, (SELECT id FROM "user" WHERE email = $3), 'Visa da Lia', 'CREDIT_CARD', 1, 10, now())
     RETURNING id`,
    [householdId, personal[email], email],
  );

  await openPage(page, `/ajustes/contas/${account!.id}`);
  await clickAndWait(
    page.getByRole("link", { name: "Adicionar cartão" }),
    pageData(`/ajustes/contas/${account!.id}/cartao`),
  );
  const dialog = page.getByRole("dialog", { name: "Adicionar cartão" });
  await expect(dialog).toBeVisible();
  await waitForReady(page);
  await dialog.getByLabel("Apelido").fill("Visa física");
  await dialog.getByLabel("Bandeira").fill("Visa");
  await dialog.getByLabel("Final").fill("0002");
  await clickAndWait(page.getByRole("button", { name: "Adicionar cartão" }), serverAction);
  await page.waitForURL(new RegExp(`/ajustes/contas/${account!.id}\\?movidos=0`));
  await expect(page.getByRole("status").filter({ hasText: "Cartão cadastrado." })).toBeVisible();
  await expect(page.getByText("Visa física")).toBeVisible();
});

test("o cartão de uma conta de outra pessoa: 404 sem nenhum dado", async ({
  page,
  browser,
}, testInfo) => {
  const ownerEmail = testEmail("contas-dona", testInfo.project.name);
  const otherEmail = testEmail("contas-outra", testInfo.project.name);
  await createTestUser(page.request, { email: ownerEmail, password: PASSWORD, name: "Lia" });
  const { householdId, personal } = await createHouseholdDirect({
    name: "Lar da dona",
    people: [{ email: ownerEmail, role: "OWNER" }],
  });
  created.push(householdId);
  const [account] = await sql<{ id: string }>(
    `INSERT INTO financial_account (id, "householdId", "walletId", "holderId", name, kind, "closingDay", "dueDay", "updatedAt")
     VALUES (gen_random_uuid(), $1, $2, (SELECT id FROM "user" WHERE email = $3), 'Cartão Sigiloso', 'CREDIT_CARD', 1, 10, now())
     RETURNING id`,
    [householdId, personal[ownerEmail], ownerEmail],
  );

  const other = await personInNewTab(browser, otherEmail, "Caio", { password: PASSWORD });
  for (const id of [account!.id, "00000000-0000-4000-8000-000000000000"]) {
    await openPage(other.page, `/ajustes/contas/${id}/cartao`);
    await expect(other.page.getByRole("heading", { level: 1 })).toHaveText("Página não encontrada");
    expect(await other.page.content()).not.toContain("Cartão Sigiloso");
  }
  await other.close();
});
