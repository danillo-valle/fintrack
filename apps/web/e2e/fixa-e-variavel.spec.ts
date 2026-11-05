// M13.3b de ponta a ponta (ADR-026, canvas linha N: N-FixaVariavel, N-Inicio, N-Limpeza). Os
// lançamentos são gravados direto no banco, sintéticos. Cada aparelho usa uma pessoa e um lar
// próprios.
//
//   1. o Início: o previsto em três partes, com a assinatura do mês passado que ainda vai chegar
//   2. a etiqueta Variável da lista vira Fixa num toque, com "as próximas desta loja também"
//   3. Editar categoria: as despesas dela são fixas por padrão
//   4. a limpeza da categoria que era transferência, com o Desfazer
//   5. na revisão, o tipo no painel da categoria: Aplicar salva sem trocar a categoria
import { randomUUID } from "node:crypto";
import { expect } from "@playwright/test";
import {
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

const PASSWORD = "frase longa da pessoa das fixas e variaveis";

function daysAgo(days: number) {
  const [y, m, d] = todaySaoPaulo()
    .split("-")
    .map((n) => Number.parseInt(n, 10)) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d - days)).toISOString().slice(0, 10);
}

/** O dia 1 do mês passado (a assinatura que veio lá e ainda não veio neste). */
function firstOfLastMonth() {
  const [y, m] = todaySaoPaulo()
    .split("-")
    .map((n) => Number.parseInt(n, 10)) as [number, number];
  return new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 10);
}

const created: string[] = [];
test.afterEach(async () => {
  await deleteHouseholds(created.splice(0));
});

test("fixa ou variável na compra, na categoria e no previsto; a limpeza das transferências", async ({
  page,
}, testInfo) => {
  test.slow(); // várias telas e ações
  const email = testEmail("fixas", testInfo.project.name);
  await createTestUser(page.request, {
    email,
    password: PASSWORD,
    name: "Lia Fixa",
    twoFactor: true,
  });
  const { householdId, personal } = await createHouseholdDirect({
    name: "Lar das fixas",
    people: [{ email, role: "OWNER" }],
  });
  created.push(householdId);
  const walletId = personal[email]!;
  const { accounts, categories } = await createFinanceDirect({
    householdId,
    accounts: [
      { walletId, name: "Conta", kind: "CHECKING", holderEmail: email },
      { walletId, name: "Poupança", kind: "SAVINGS", holderEmail: email },
    ],
    categories: [
      { name: "Assinaturas", kind: "EXPENSE" },
      { name: "Mercado", kind: "EXPENSE" },
      { name: "Resgate Poupança", kind: "INCOME" },
    ],
    transactions: [
      {
        walletId,
        account: "Conta",
        amount: "-55.90",
        occurredOn: firstOfLastMonth(),
        description: "NETFLIX.COM",
        category: "Assinaturas",
      },
      {
        walletId,
        account: "Conta",
        amount: "-120.00",
        occurredOn: todaySaoPaulo(),
        description: "MERCADO BOM PRECO",
        category: "Mercado",
      },
      // O resgate da poupança com categoria (de antes do M13.2): dois pares e um sozinho
      ...[
        ["Poupança", "-300.00", 10, null],
        ["Conta", "300.00", 10, "Resgate Poupança"],
        ["Poupança", "-200.00", 20, null],
        ["Conta", "200.00", 21, "Resgate Poupança"],
        ["Conta", "150.00", 40, "Resgate Poupança"],
      ].map(([account, amount, days, category]) => ({
        walletId,
        account: account as string,
        amount: amount as string,
        occurredOn: daysAgo(days as number),
        description: "RESGATE POUPANCA",
        ...(category ? { category: category as string } : {}),
      })),
    ],
  });
  await sql(`UPDATE category SET "defaultNature" = 'FIXED' WHERE id = $1`, [
    categories.Assinaturas,
  ]);

  // ── 1. O previsto em três partes ──
  await openPage(page, "/");
  const fixed = page.getByTestId("previsto-fixas");
  await expect(fixed).toContainText("falta NETFLIX.COM");
  await expect(fixed).toContainText("R$ 55,90");
  await expect(page.getByTestId("previsto-parcelas")).toBeVisible();
  await expect(page.getByTestId("previsto-variaveis")).toContainText("no ritmo do mês");
  await expectNoA11yViolations(page);

  // ── 2. A etiqueta da lista, num toque ──
  await openPage(page, `/lancamentos?conta=${accounts.Conta!.id}`);
  await page.getByLabel("Variável: trocar o tipo de MERCADO BOM PRECO", { exact: true }).click();
  const dialog = page.getByRole("dialog", { name: /Tipo da despesa: MERCADO BOM PRECO/ });
  await expect(dialog).toBeVisible();
  await expectNoA11yViolations(page);
  await dialog.getByText("Fixa", { exact: true }).click();
  await dialog.getByLabel(/As próximas de “MERCADO BOM PRECO” também/).check();
  await dialog.getByRole("button", { name: "Salvar" }).click();
  await expect
    .poll(
      async () =>
        (
          await sql<{ nature: string | null }>(
            `SELECT nature FROM "transaction" WHERE "householdId" = $1 AND description = 'MERCADO BOM PRECO'`,
            [householdId],
          )
        )[0]?.nature,
    )
    .toBe("FIXED");
  const rules = await sql<{ pattern: string; nature: string | null }>(
    `SELECT pattern, nature FROM category_rule WHERE "householdId" = $1`,
    [householdId],
  );
  expect(rules).toEqual([{ pattern: "mercado bom preco", nature: "FIXED" }]);
  await expect(
    page.getByLabel("Fixa: trocar o tipo de MERCADO BOM PRECO", { exact: true }),
  ).toBeVisible();

  // ── 3. Editar categoria: o padrão das despesas ──
  await openPage(page, `/ajustes/categorias/${categories.Mercado}`);
  await expectNoA11yViolations(page);
  await page.getByText("Fixas", { exact: true }).click();
  await page.getByRole("button", { name: "Salvar" }).click();
  await page.waitForURL(/\/ajustes\/categorias\?editada=/);
  const [mercado] = await sql<{ defaultNature: string }>(
    `SELECT "defaultNature" FROM category WHERE id = $1`,
    [categories.Mercado],
  );
  expect(mercado!.defaultNature).toBe("FIXED");

  // ── 4. A categoria que era transferência ──
  await openPage(page, "/ajustes/categorias");
  const banner = page.getByTestId("limpeza-aviso");
  await expect(banner).toContainText("1 categoria parece transferência");
  await expectNoA11yViolations(page);
  await banner.getByRole("link", { name: "Revisar" }).click();
  const review = page.getByTestId("limpeza-revisao");
  await expect(review).toContainText("Resgate Poupança é transferência?");
  await expect(review.getByRole("list", { name: /Os pares/ }).getByRole("listitem")).toHaveCount(2);
  await expectNoA11yViolations(page);
  await review.getByRole("button", { name: "Tratar os 3 como transferência" }).click();
  const done = page.getByTestId("limpeza-feita");
  await expect(done).toContainText("5 lançamentos viraram transferência");
  const converted = await sql<{ transferId: string | null; categoryId: string | null }>(
    `SELECT "transferId", "categoryId" FROM "transaction"
      WHERE "householdId" = $1 AND description = 'RESGATE POUPANCA'`,
    [householdId],
  );
  expect(converted.every((t) => t.transferId !== null && t.categoryId === null)).toBe(true);
  await done.getByRole("button", { name: /Desfazer/ }).click();
  await expect
    .poll(
      async () =>
        (
          await sql<{ n: string }>(
            `SELECT count(*)::text AS n FROM "transaction"
            WHERE "householdId" = $1 AND description = 'RESGATE POUPANCA' AND "transferId" IS NULL`,
            [householdId],
          )
        )[0]?.n,
    )
    .toBe("5");

  // ── 5. Na revisão: o tipo no painel da categoria ──
  const [spotify] = await sql<{ id: string }>(
    `INSERT INTO "transaction" (id, "householdId", "walletId", "accountId", method, amount, "occurredOn",
       description, "categoryId", "categorizedBy", status, source, "externalId", "updatedAt")
     VALUES (gen_random_uuid(), $1, $2, $3, 'PIX', '-21.90', $4, 'SPOTIFY BRASIL', $5, 'HISTORY',
       'PENDING', 'OPEN_FINANCE', $6, now())
     RETURNING id`,
    [
      householdId,
      walletId,
      accounts.Conta!.id,
      todaySaoPaulo(),
      categories.Assinaturas,
      `e2e-${randomUUID()}`,
    ],
  );
  await openPage(page, "/lancamentos/recebidos");
  const row = page.getByTestId("recebido").filter({ hasText: "SPOTIFY BRASIL" });
  await expect(row).toContainText("Fixa");
  await row
    .locator("summary")
    .filter({ hasText: /trocar categoria de SPOTIFY BRASIL/, visible: true })
    .click();
  const picker = page.getByRole("dialog", { name: /Categoria.*SPOTIFY BRASIL/ });
  await expect(picker.getByRole("group", { name: "Tipo da despesa" })).toBeVisible();
  await expectNoA11yViolations(page);
  await picker.getByText("Variável", { exact: true }).click();
  await picker.getByRole("button", { name: /Aplicar/ }).click();
  await expect
    .poll(
      async () =>
        (
          await sql<{ nature: string | null; categoryId: string }>(
            `SELECT nature, "categoryId" FROM "transaction" WHERE id = $1`,
            [spotify!.id],
          )
        )[0],
    )
    .toEqual({ nature: "VARIABLE", categoryId: categories.Assinaturas });
});
