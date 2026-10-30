// Contas e cartões revistos e Editar cartão (M13.1, pranchas L-Contas e L-EditarCartao), nos dois
// aparelhos. A pendência que apareceu no primeiro uso real: os cartões adicionais foram
// cadastrados com o portador errado, e não havia como corrigir sem arquivar e cadastrar de novo;
// e as compras do cartão da casa (um adicional) não tinham como entrar direto na Casa.
//
// E o de sempre: a URL de editar o cartão de outra pessoa responde a 404 sem nenhum dado.
// Dados sintéticos (Lia e Caio, finais 0001 e 0002).
import { expect } from "@playwright/test";
import {
  clickAndWait,
  createHouseholdDirect,
  createTestUser,
  deleteHouseholds,
  expectNoA11yViolations,
  openPage,
  pageData,
  personInNewTab,
  serverAction,
  sql,
  test,
  testEmail,
  waitForReady,
} from "./helpers";

const PASSWORD = "frase longa de quem cuida dos cartoes";

const created: string[] = [];
test.afterEach(async () => {
  await deleteHouseholds(created.splice(0));
});

test("editar o adicional: quem usa, compras conjuntas e as compras do banco na Casa", async ({
  page,
}, testInfo) => {
  const lia = testEmail("cartao-lia", testInfo.project.name);
  const caio = testEmail("cartao-caio", testInfo.project.name);
  await createTestUser(page.request, { email: caio, password: PASSWORD, name: "Caio Moura" });
  await createTestUser(page.request, { email: lia, password: PASSWORD, name: "Lia Moura" });
  const { householdId, personal, shared } = await createHouseholdDirect({
    name: "Lar Moura",
    people: [
      { email: lia, role: "OWNER" },
      { email: caio, role: "MEMBER" },
    ],
    shared: [
      {
        name: "Casa",
        members: [
          { email: lia, role: "OWNER" },
          { email: caio, role: "OWNER" },
        ],
      },
    ],
  });
  created.push(householdId);
  // A conta do cartão é da Lia; os dois cartões foram cadastrados com ela de portadora (o erro)
  const [account] = await sql<{ id: string }>(
    `INSERT INTO financial_account (id, "householdId", "walletId", "holderId", name, kind, "closingDay", "dueDay", "updatedAt")
     VALUES (gen_random_uuid(), $1, $2, (SELECT id FROM "user" WHERE email = $3), 'Aurora Mastercard', 'CREDIT_CARD', 3, 9, now())
     RETURNING id`,
    [householdId, personal[lia], lia],
  );
  const [card] = await sql<{ id: string }>(
    `INSERT INTO payment_card (id, "accountId", "holderId", nickname, brand, "lastFour", form, "updatedAt")
     VALUES (gen_random_uuid(), $1, (SELECT id FROM "user" WHERE email = $2), 'Master da casa', 'Mastercard', '0002', 'PHYSICAL', now()),
            (gen_random_uuid(), $1, (SELECT id FROM "user" WHERE email = $2), 'Master da Lia', 'Mastercard', '0001', 'PHYSICAL', now())
     RETURNING id`,
    [account!.id, lia],
  );
  // Um recebido do banco do final 0002, ainda não confirmado, no pessoal da Lia
  await sql(
    `INSERT INTO "transaction" (id, "householdId", "walletId", "accountId", "cardId", method, amount, "occurredOn", description, status, source, "externalId", "providerCardLastFour", "updatedAt")
     VALUES (gen_random_uuid(), $1, $2, $3, $4, 'CREDIT', -42.5, CURRENT_DATE, 'mercado sintetico', 'PENDING', 'OPEN_FINANCE', 'ext-cartao-' || gen_random_uuid(), '0002', now())`,
    [householdId, personal[lia], account!.id, card!.id],
  );

  // 1. A lista: o cartão é uma peça com as iniciais de quem usa; as ações ficam no "⋯"
  await openPage(page, "/ajustes/contas");
  const cards = page
    .getByRole("list", { name: "Cartões de Aurora Mastercard" })
    .filter({ visible: true });
  const tile = cards.getByRole("listitem").filter({ hasText: "Master da casa" });
  await expect(tile).toContainText("Mastercard ···· 0002");
  await expect(tile).toContainText("Lia");
  await expect(tile.getByRole("link", { name: "Editar cartão" })).toBeHidden();
  const menu = tile.getByRole("button", { name: "Opções do cartão Master da casa" });
  await expect(menu).toHaveAttribute("aria-expanded", "false");
  await menu.click();
  await expect(menu).toHaveAttribute("aria-expanded", "true");
  await expectNoA11yViolations(page);
  // Esc fecha e devolve o foco ao botão
  await page.keyboard.press("Escape");
  await expect(menu).toHaveAttribute("aria-expanded", "false");
  await expect(menu).toBeFocused();
  await menu.click();

  // 2. Editar abre o modal com o cartão como está; o final não se edita
  await clickAndWait(
    tile.getByRole("link", { name: "Editar cartão" }),
    pageData(`/ajustes/contas/${account!.id}/cartao/${card!.id}`),
  );
  const dialog = page.getByRole("dialog", { name: "Editar cartão" });
  await expect(dialog).toBeVisible();
  await waitForReady(page);
  await expect(dialog.getByLabel("Apelido")).toHaveValue("Master da casa");
  await expect(dialog.getByLabel("Final")).toHaveAttribute("readonly", "");
  await expect(dialog.getByLabel("Final")).toHaveValue("···· 0002");
  // Com a Lia de portadora, o padrão é o ambiente da conta, e o pessoal do Caio não aparece
  const destination = dialog.getByLabel("Compras do banco entram em");
  await expect(destination.locator("option")).toHaveText([`Padrão: ${lia.split("@")[0]}`, "Casa"]);

  // 3. Quem usa: o Caio. O padrão vira o pessoal dele; escolhe a Casa e marca as duas caixas
  await dialog.getByLabel("Quem usa (portador)").selectOption({ label: "Caio Moura" });
  await expect(destination.locator("option").first()).toHaveText("Padrão: pessoal de Caio");
  await destination.selectOption({ label: "Casa" });
  await dialog.getByLabel("Cartão adicional", { exact: false }).check();
  await dialog.getByRole("checkbox", { name: /Compras conjuntas/ }).check();
  await expectNoA11yViolations(page);
  await clickAndWait(page.getByRole("button", { name: "Salvar" }), serverAction);

  // 4. Volta com o aviso; a peça mostra o Caio, as etiquetas e para onde vão as compras
  await page.waitForURL(/\/ajustes\/contas\?editado=/);
  await waitForReady(page);
  await expect(page.getByTestId("aviso-criado").filter({ visible: true })).toContainText(
    "Cartão “Master da casa” atualizado. 1 recebido do banco foi para o novo ambiente.",
  );
  await expect(tile).toContainText("Caio");
  await expect(tile).toContainText("Adicional");
  await expect(tile).toContainText("Compras conjuntas");
  await expect(tile).toContainText("Compras do banco entram em Casa");

  // No banco: o portador, as marcas, o ambiente e o recebido na Casa; o final igual
  const [after] = await sql<{
    holder: string;
    isAdditional: boolean;
    sharedPurchases: boolean;
    importWalletId: string;
    lastFour: string;
    moved: string;
  }>(
    `SELECT u.email AS holder, c."isAdditional", c."sharedPurchases", c."importWalletId", c."lastFour",
            (SELECT "walletId"::text FROM "transaction" WHERE "cardId" = c.id) AS moved
       FROM payment_card c JOIN "user" u ON u.id = c."holderId" WHERE c.id = $1`,
    [card!.id],
  );
  expect(after).toEqual({
    holder: caio,
    isAdditional: true,
    sharedPurchases: true,
    importWalletId: shared["Casa"],
    lastFour: "0002",
    moved: shared["Casa"],
  });
  const [audit] = await sql<{ metadata: string }>(
    `SELECT metadata::text FROM audit_log WHERE "householdId" = $1 AND action = 'card.updated'`,
    [householdId],
  );
  expect(audit!.metadata).not.toContain("0002");
});

test("editar o cartão de outra pessoa: 404 sem nenhum dado", async ({
  page,
  browser,
}, testInfo) => {
  const ownerEmail = testEmail("editar-dona", testInfo.project.name);
  const otherEmail = testEmail("editar-outra", testInfo.project.name);
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
  const [card] = await sql<{ id: string }>(
    `INSERT INTO payment_card (id, "accountId", "holderId", nickname, brand, "lastFour", form, "updatedAt")
     VALUES (gen_random_uuid(), $1, (SELECT id FROM "user" WHERE email = $2), 'Apelido Sigiloso', 'Visa', '0001', 'PHYSICAL', now())
     RETURNING id`,
    [account!.id, ownerEmail],
  );

  const other = await personInNewTab(browser, otherEmail, "Caio", { password: PASSWORD });
  for (const path of [
    `/ajustes/contas/${account!.id}/cartao/${card!.id}`,
    `/ajustes/contas/${account!.id}/cartao/00000000-0000-4000-8000-000000000000`,
  ]) {
    await openPage(other.page, path);
    await expect(other.page.getByRole("heading", { level: 1 })).toHaveText("Página não encontrada");
    const html = await other.page.content();
    expect(html).not.toContain("Cartão Sigiloso");
    expect(html).not.toContain("Apelido Sigiloso");
  }
  await other.close();
});
