// Revisão e reconciliação (M09.2) de ponta a ponta. Os recebidos são gravados direto no banco
// (sintéticos, como a busca grava: PENDING, OPEN_FINANCE, id do banco), sem passar pela Pluggy:
// a busca já é provada no coleta-bancaria.spec.ts. Cada aparelho usa uma pessoa e um lar próprios.
//
//   1. a revisão mostra o par (mesmo valor, 1 dia), o estorno e o final não cadastrado
//   2. "Confirmar par" abre o modal; confirmar junta os dois; "Desfazer" devolve; juntar de novo
//   3. "Ligar ao original" liga o estorno à compra
//   4. "Confirmar os N que já têm categoria" e o "Confirmar" da linha
//   5. "Cadastrar o cartão" do final 0009: o recebido vai para o cartão novo
//   6. outra pessoa abre a conta em Ajustes › Contas: 404
import { randomUUID } from "node:crypto";
import { expect, type Page } from "@playwright/test";
import {
  AUTH_FILE,
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

const PASSWORD = "frase longa da pessoa da revisao";

function daysAgo(days: number) {
  const [y, m, d] = todaySaoPaulo()
    .split("-")
    .map((n) => Number.parseInt(n, 10)) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d - days)).toISOString().slice(0, 10);
}

const created: string[] = [];
test.afterEach(async () => {
  await deleteHouseholds(created.splice(0));
});

/** Um recebido do banco, como a busca grava (o final do cartão só com 4 dígitos). */
async function received(input: {
  householdId: string;
  walletId: string;
  accountId: string;
  cardId: string | null;
  lastFour: string;
  amount: string;
  occurredOn: string;
  description: string;
  categoryId?: string | null;
}) {
  const [row] = await sql<{ id: string }>(
    `INSERT INTO "transaction" (id, "householdId", "walletId", "accountId", "cardId", method, "categoryId", "categorizedBy",
       amount, "occurredOn", description, status, source, "externalId", "providerCardLastFour", "updatedAt")
     VALUES (gen_random_uuid(), $1, $2, $3, $4, 'CREDIT', $5, $6, $7, $8, $9, 'PENDING', 'OPEN_FINANCE', $10, $11, now())
     RETURNING id`,
    [
      input.householdId,
      input.walletId,
      input.accountId,
      input.cardId,
      input.categoryId ?? null,
      input.categoryId ? "RULE" : null,
      input.amount,
      input.occurredOn,
      input.description,
      `e2e-${randomUUID()}`,
      input.lastFour,
    ],
  );
  return row!.id;
}

const statusOf = async (id: string) =>
  (await sql<{ status: string }>('SELECT status FROM "transaction" WHERE id = $1', [id]))[0]!
    .status;

const toast = (page: Page, text: RegExp) =>
  page.locator("[data-sonner-toast]").filter({ hasText: text });

test("revisar os recebidos: par, estorno, lote, linha e o final não cadastrado", async ({
  page,
  browser,
}, testInfo) => {
  test.slow(); // várias ações e duas telas novas
  const email = testEmail("revisao", testInfo.project.name);
  await createTestUser(page.request, {
    email,
    password: PASSWORD,
    name: "Lia Revisão",
    twoFactor: true,
  });
  const { householdId, personal } = await createHouseholdDirect({
    name: "Lar da revisão",
    people: [{ email, role: "OWNER" }],
  });
  created.push(householdId);
  const walletId = personal[email]!;
  const { accounts, categories, cards } = await createFinanceDirect({
    householdId,
    accounts: [
      {
        walletId,
        name: "Mastercard",
        kind: "CREDIT_CARD",
        holderEmail: email,
        closingDay: 27,
        dueDay: 5,
        cards: [{ nickname: "Master Lia", lastFour: "0001", holderEmail: email }],
      },
    ],
    categories: [
      { name: "Mercado", kind: "EXPENSE" },
      { name: "Restaurantes", kind: "EXPENSE" },
      { name: "Combustível", kind: "EXPENSE" },
    ],
    transactions: [
      {
        walletId,
        account: "Mastercard",
        amount: "-312.48",
        occurredOn: daysAgo(2),
        description: "Mercado da esquina",
        category: "Mercado",
        card: "Master Lia",
      },
      {
        walletId,
        account: "Mastercard",
        amount: "-187.72",
        occurredOn: daysAgo(6),
        description: "Restaurante Sabor",
        category: "Restaurantes",
        card: "Master Lia",
      },
    ],
  });
  const accountId = accounts.Mastercard!.id;
  const base = { householdId, walletId, accountId, cardId: cards["Master Lia"]!, lastFour: "0001" };
  const mercado = await received({
    ...base,
    amount: "-312.48",
    occurredOn: daysAgo(1),
    description: "MERCADO BOM PRECO",
  });
  await received({
    ...base,
    amount: "187.72",
    occurredOn: daysAgo(2),
    description: "ESTORNO RESTAURANTE SABOR",
  });
  const posto = await received({
    ...base,
    amount: "-220.00",
    occurredOn: daysAgo(3),
    description: "POSTO ESTRELA",
    categoryId: categories["Combustível"]!,
  });
  const livraria = await received({
    ...base,
    amount: "-59.00",
    occurredOn: daysAgo(4),
    description: "LIVRARIA NOBRE",
  });
  const padaria = await received({
    ...base,
    cardId: null,
    lastFour: "0009",
    amount: "-23.50",
    occurredOn: daysAgo(5),
    description: "PADARIA DO BAIRRO",
  });

  // ── 1. A revisão ──
  await openPage(page, "/lancamentos/recebidos");
  await expect(page.getByRole("heading", { level: 1, name: "Recebidos do banco" })).toBeVisible();
  await expect(page.getByTestId("aviso-final")).toContainText("1 compra do final 0009");
  const pairs = page.getByTestId("par-sugerido");
  await expect(pairs).toHaveCount(2);
  await expect(pairs.filter({ hasText: "Mesmo valor, 1 dia depois" })).toContainText(
    "Mercado da esquina",
  );
  await expect(pairs.filter({ hasText: /Estorno da compra de/ })).toContainText(
    "ESTORNO RESTAURANTE SABOR",
  );
  await expectNoA11yViolations(page);

  // ── 2. Confirmar o par (modal), desfazer e juntar de novo ──
  const confirmPair = async () => {
    await pairs
      .filter({ hasText: "MERCADO BOM PRECO" })
      .getByRole("link", { name: "Confirmar par" })
      .click();
    await page.waitForURL("**/lancamentos/recebidos/par/**");
    const dialog = page.getByRole("dialog", { name: "Confirmar o par" });
    await expect(dialog).toBeVisible();
    await expect(
      dialog.getByText("fica a do banco").filter({ visible: true }).first(),
    ).toBeVisible();
    return dialog;
  };
  let dialog = await confirmPair();
  await expectNoA11yViolations(page); // o modal com a comparação
  await dialog.getByRole("button", { name: "Confirmar par" }).click();
  await page.waitForURL(/\/lancamentos\/recebidos(\?|$)/);
  await expect(toast(page, /Par confirmado/)).toBeVisible();
  expect(await statusOf(mercado)).toBe("CONFIRMED");
  const merged = await sql<{ description: string }>(
    'SELECT description FROM "transaction" WHERE id = $1',
    [mercado],
  );
  expect(merged[0]!.description).toBe("Mercado da esquina"); // fica o seu lado
  await toast(page, /Par confirmado/)
    .getByRole("button", { name: "Desfazer" })
    .click();
  await expect(toast(page, /Desfeito/)).toBeVisible();
  await expect.poll(() => statusOf(mercado)).toBe("PENDING");
  await openPage(page, "/lancamentos/recebidos");
  dialog = await confirmPair();
  await dialog.getByRole("button", { name: "Confirmar par" }).click();
  await page.waitForURL(/\/lancamentos\/recebidos(\?|$)/);
  await expect.poll(() => statusOf(mercado)).toBe("CONFIRMED");

  // ── 3. Estorno ──
  await pairs
    .filter({ hasText: "ESTORNO RESTAURANTE SABOR" })
    .getByRole("button", { name: "Ligar ao original" })
    .click();
  await expect(toast(page, /Estorno ligado/)).toBeVisible();
  await expect(pairs).toHaveCount(0);

  // ── 4. Em lote (só o posto tem categoria) e na linha ──
  await page.getByRole("button", { name: "Confirmar o que já tem categoria" }).click();
  await expect(toast(page, /1 recebido confirmado/)).toBeVisible();
  await expect.poll(() => statusOf(posto)).toBe("CONFIRMED");
  expect(await statusOf(livraria)).toBe("PENDING");
  await page.getByRole("button", { name: "Confirmar LIVRARIA NOBRE" }).click();
  await expect.poll(() => statusOf(livraria)).toBe("CONFIRMED");

  // ── 5. O final 0009: cadastrar o cartão leva o recebido para ele ──
  await page.getByRole("link", { name: "Cadastrar o cartão final 0009" }).click();
  await page.waitForURL(`**/ajustes/contas/${accountId}**`);
  const form = page.getByRole("form", { name: "Cadastrar o cartão final 0009" });
  await expect(form).toBeVisible();
  await expectNoA11yViolations(page);
  await form.getByLabel("Apelido").fill("Master virtual");
  await form.getByRole("button", { name: "Cadastrar e reorganizar" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "1 recebido foi para ele" }),
  ).toBeVisible();
  const [moved] = await sql<{ lastFour: string | null }>(
    `SELECT c."lastFour" FROM "transaction" t LEFT JOIN payment_card c ON c.id = t."cardId" WHERE t.id = $1`,
    [padaria],
  );
  expect(moved!.lastFour).toBe("0009");

  // ── 6. Outra pessoa (a Ana) abre a conta: 404, sem os cartões no HTML ──
  const ana = await browser.newContext({ storageState: AUTH_FILE });
  const anaPage = await ana.newPage();
  await openPage(anaPage, `/ajustes/contas/${accountId}`);
  await expect(anaPage.getByRole("heading", { name: "Esta página não existe" })).toBeVisible();
  expect(await anaPage.content()).not.toContain("Master virtual");
  await ana.close();
});
