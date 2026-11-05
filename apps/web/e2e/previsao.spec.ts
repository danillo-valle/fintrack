// M13.3c de ponta a ponta (ADR-027, canvas linhas N e O). Os lançamentos são gravados direto no
// banco, sintéticos; a escolha do tipo é feita pela tela. Cada aparelho usa uma pessoa e um lar
// próprios.
//
//   1. o salário: Tipo da receita Fixa, no 5º dia útil, pela média de 3 meses; a assinatura do
//      cartão vira previsão; Fixas e parcelas, Mudar o valor (modal, aviso no topo); Próximos meses
//      no Início; o mês que vem na conta; a fatura que ainda não abriu em Cartões
//   2. a compra parcelada que o banco não informou: Parcelada 2 de 5, as previstas nas faturas
import { expect } from "@playwright/test";
import {
  ANA_FINANCE,
  clearMoney,
  createFinanceDirect,
  createHouseholdDirect,
  createTestUser,
  deleteHouseholds,
  expectNoA11yViolations,
  openPage,
  sql,
  test,
  testEmail,
  todaySaoPaulo,
} from "./helpers";

const PASSWORD = "frase longa da pessoa que preve os meses";

/** O mês daqui a `n` meses ("2026-12"). */
function monthAhead(n: number) {
  const [y, m] = todaySaoPaulo()
    .split("-")
    .map((v) => Number.parseInt(v, 10)) as [number, number];
  return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7);
}

const monthTitle = (month: string) => {
  const name = new Intl.DateTimeFormat("pt-BR", { month: "long", timeZone: "UTC" }).format(
    new Date(`${month}-15T12:00:00Z`),
  );
  return name.charAt(0).toUpperCase() + name.slice(1);
};

const created: string[] = [];
test.afterEach(async () => {
  await deleteHouseholds(created.splice(0));
});

async function household(page: import("@playwright/test").Page, slug: string, project: string) {
  const email = testEmail(slug, project);
  await createTestUser(page.request, {
    email,
    password: PASSWORD,
    name: "Rui Previsto",
    twoFactor: true,
  });
  const { householdId, personal } = await createHouseholdDirect({
    name: "Lar do previsto",
    people: [{ email, role: "OWNER" }],
  });
  created.push(householdId);
  const walletId = personal[email]!;
  const finance = await createFinanceDirect({
    householdId,
    accounts: [
      { walletId, name: "Conta corrente", kind: "CHECKING", holderEmail: email },
      {
        walletId,
        name: "Cartão Aurora",
        kind: "CREDIT_CARD",
        holderEmail: email,
        closingDay: 3,
        dueDay: 10,
        cards: [{ nickname: "Físico", lastFour: "0001", holderEmail: email }],
      },
    ],
    categories: [
      { name: "Salário", kind: "INCOME" },
      { name: "Assinaturas", kind: "EXPENSE" },
      { name: "Eletrônicos", kind: "EXPENSE" },
    ],
  });
  return { householdId, walletId, ...finance };
}

async function insert(
  householdId: string,
  walletId: string,
  accountId: string,
  row: { amount: string; description: string; categoryId: string; method: string },
) {
  const [inserted] = await sql<{ id: string }>(
    `INSERT INTO "transaction" (id, "householdId", "walletId", "accountId", method, "categoryId",
       amount, "occurredOn", description, "updatedAt")
     VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, now()) RETURNING id`,
    [
      householdId,
      walletId,
      accountId,
      row.method,
      row.categoryId,
      row.amount,
      todaySaoPaulo(),
      row.description,
    ],
  );
  return inserted!.id;
}

test("o que se repete: o salário, a assinatura, Mudar o valor e os próximos meses", async ({
  page,
}, testInfo) => {
  test.slow(); // várias telas e ações
  const h = await household(page, "previsao", testInfo.project.name);
  const checking = h.accounts["Conta corrente"]!.id;
  const card = h.accounts["Cartão Aurora"]!.id;
  await sql(`UPDATE category SET "defaultNature" = 'FIXED' WHERE id = $1`, [
    h.categories.Assinaturas,
  ]);
  const salary = await insert(h.householdId, h.walletId, checking, {
    amount: "9850.00",
    description: "SALARIO EMPRESA EXEMPLO",
    categoryId: h.categories.Salário!,
    method: "PIX",
  });
  const spotify = await insert(h.householdId, h.walletId, card, {
    amount: "-21.90",
    description: "SPOTIFY",
    categoryId: h.categories.Assinaturas!,
    method: "CREDIT",
  });

  // ── 1. Tipo da receita: Fixa, no 5º dia útil, pela média de 3 meses ──
  await openPage(page, `/lancamentos/${salary}`);
  const income = page.getByRole("form", { name: "Tipo da receita" });
  await income.getByText("Fixa", { exact: true }).click();
  await expect(income.getByRole("region", { name: "Repete todo mês" })).toBeVisible();
  await expect(income.getByText("Entra todo mês na Conta corrente")).toBeVisible();
  await income.getByText("Média de 3 meses").click();
  await income.getByLabel("Quando cai").selectOption("BUSINESS_DAY");
  await income.getByLabel("Dia", { exact: true }).fill("5");
  await expectNoA11yViolations(page);
  await income.getByRole("button", { name: "Salvar o tipo" }).click();
  await expect(income.getByText(/Ela fica prevista nos próximos meses/)).toBeVisible();
  const [series] = await sql<{ origin: string; dayRule: string; amountRule: string }>(
    `SELECT origin, "dayRule", "amountRule" FROM recurrence WHERE "householdId" = $1 AND kind = 'INCOME'`,
    [h.householdId],
  );
  expect(series).toEqual({ origin: "BANK", dayRule: "BUSINESS_DAY", amountRule: "AVERAGE_3" });

  // ── 2. A assinatura do cartão: Fixa (pela categoria), o último que chegou ──
  await openPage(page, `/lancamentos/${spotify}`);
  const expense = page.getByRole("form", { name: "Tipo da despesa" });
  await expect(expense.getByRole("radio", { name: "Fixa" })).toBeChecked();
  await expect(expense.getByRole("radio", { name: "Parcelada" })).toBeVisible();
  await expense.getByRole("button", { name: "Salvar o tipo" }).click();
  await expect(expense.getByText(/Ela fica prevista nos próximos meses/)).toBeVisible();

  // ── 3. Fixas e parcelas: as duas, e Mudar o valor no modal ──
  await openPage(page, "/fixas");
  const salaryRow = page.getByTestId("fixa").filter({ hasText: "SALARIO EMPRESA EXEMPLO" });
  await expect(salaryRow).toContainText("5º dia útil");
  await expect(salaryRow).toContainText("média de 3 meses");
  const spotifyRow = page.getByTestId("fixa").filter({ hasText: "SPOTIFY" });
  await expect(spotifyRow).toContainText("o último que chegou");
  await expectNoA11yViolations(page);
  await spotifyRow.getByRole("button", { name: "Opções de SPOTIFY" }).click();
  await spotifyRow.getByRole("link", { name: "Mudar o valor" }).click();
  const modal = page.getByRole("dialog", { name: "Mudar o valor" });
  await expect(modal).toBeVisible();
  await expect(modal.getByText("Os últimos que chegaram")).toBeVisible();
  await modal.getByText("Um valor fixo").click();
  const value = modal.getByRole("textbox", { name: "Valor fixo" });
  await clearMoney(value);
  await value.pressSequentially("2500");
  await modal.getByLabel("Dia", { exact: true }).fill("2");
  await expectNoA11yViolations(page);
  await modal.getByRole("button", { name: "Salvar" }).click();
  await expect(page).toHaveURL(/\/fixas\?mudada=/);
  await expect(page.getByTestId("aviso-criado")).toContainText("SPOTIFY");
  const marked = page.locator("[data-testid=fixa][data-marked]");
  await expect(marked).toContainText("R$ 25,00");
  await expect(marked).toContainText("todo dia 02");
  await expect(marked).toContainText("valor fixo");

  // ── 4. Próximos meses no Início: o salário entra todo mês ──
  await openPage(page, "/");
  const next = page.getByRole("region", { name: "Próximos meses" });
  await expect(next).toBeVisible();
  const months = next.getByTestId(
    testInfo.project.name === "mobile" ? "proximos-meses-celular" : "proximos-meses",
  );
  await expect(months).toContainText(monthTitle(monthAhead(1)));
  await expect(months).toContainText("+ R$ 9.850,00");
  await expectNoA11yViolations(page);

  // ── 5. O mês que vem na conta: o salário previsto ──
  await openPage(page, `/lancamentos?conta=${checking}&mes=${monthAhead(1)}`);
  const planned = page.getByTestId("conta-prevista");
  await expect(planned).toContainText(`${monthTitle(monthAhead(1))}, previsto`);
  await expect(
    planned.getByTestId("prevista").filter({ hasText: "SALARIO EMPRESA EXEMPLO" }),
  ).toContainText("Prevista");
  await expectNoA11yViolations(page);

  // ── 6. A fatura que ainda não abriu: a assinatura prevista ──
  await openPage(page, `/cartoes?conta=${card}&fatura=prevista-${monthAhead(2)}`);
  await expect(page.getByText("o que já se sabe")).toBeVisible();
  await expect(page.getByTestId("fatura-total")).toContainText("R$ 25,00");
  const fixed = page.getByRole("list", { name: "Fixas previstas" });
  await expect(fixed.getByTestId("prevista").filter({ hasText: "SPOTIFY" })).toContainText(
    "Prevista",
  );
  await expectNoA11yViolations(page);
});

test("a compra parcelada que o banco não informou: 2 de 5 e as previstas", async ({
  page,
}, testInfo) => {
  const h = await household(page, "parcelada", testInfo.project.name);
  const card = h.accounts["Cartão Aurora"]!.id;
  const notebook = await insert(h.householdId, h.walletId, card, {
    amount: "-640.00",
    description: "NOTEBOOK LOJA TEC",
    categoryId: h.categories.Eletrônicos!,
    method: "CREDIT",
  });

  await openPage(page, `/lancamentos/${notebook}`);
  const form = page.getByRole("form", { name: "Tipo da despesa" });
  await form.getByText("Parcelada", { exact: true }).click();
  await form.getByLabel("Parcela", { exact: true }).fill("2");
  await form.getByLabel("de", { exact: true }).fill("5");
  await expect(form.getByText("R$ 3.200,00")).toBeVisible();
  const track = form.getByRole("list", { name: "As parcelas desta compra" });
  await expect(track.getByRole("listitem")).toHaveCount(5);
  await expect(track.getByRole("listitem").nth(2)).toContainText("prevista");
  await expect(form.getByText(/As 3 que faltam ficam previstas/)).toContainText("R$ 1.920,00");
  await expectNoA11yViolations(page);
  await form.getByRole("button", { name: "Salvar o tipo" }).click();
  await expect(form.getByText(/As parcelas que faltam ficam previstas/)).toBeVisible();
  const [row] = await sql<{ n: number; c: number; byPerson: boolean }>(
    `SELECT "providerInstallmentNumber" AS n, "providerInstallmentCount" AS c,
            "installmentByPerson" AS "byPerson" FROM "transaction" WHERE id = $1`,
    [notebook],
  );
  expect(row).toEqual({ n: 2, c: 5, byPerson: true });

  // Em Fixas e parcelas, a parcelada em andamento
  await openPage(page, "/fixas?mostrar=parceladas");
  await expect(
    page.getByTestId("parcelada").filter({ hasText: "NOTEBOOK LOJA TEC" }),
  ).toContainText("faltam 3");

  // Em Cartões, a parcela 4/5 numa fatura que ainda não abriu
  await openPage(page, `/cartoes?conta=${card}&fatura=prevista-${monthAhead(3)}`);
  const parcels = page.getByRole("list", { name: "Parcelas previstas" });
  await expect(
    parcels.getByTestId("prevista").filter({ hasText: "NOTEBOOK LOJA TEC" }),
  ).toBeVisible();
  await expectNoA11yViolations(page);
});

test("Mudar o valor de uma recorrência de outra pessoa ou inventada: 404 sem nenhum dado", async ({
  page,
}, testInfo) => {
  // A Ana (o lar fixo dos testes) tem o "Aluguel da Ana"; esta pessoa não é do lar dela
  await household(page, "previsao-outra", testInfo.project.name);
  for (const path of [
    `/fixas/${ANA_FINANCE.recurrenceId}`,
    "/fixas/00000000-0000-4000-8000-000000000000",
  ]) {
    await openPage(page, path);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Página não encontrada");
    expect(await page.content()).not.toContain("Aluguel da Ana");
  }
});
