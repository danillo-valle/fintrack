// M13.2 de ponta a ponta (canvas linha M; adendos dos ADRs 011 e 012). Os recebidos são gravados
// direto no banco, sintéticos, como a busca grava (PENDING, OPEN_FINANCE, id do banco). Cada
// aparelho usa uma pessoa e um lar próprios.
//
//   1. a transferência sugerida entre a conta e a poupança: confirmar, desfazer, confirmar de novo
//   2. o "O que foi" ao lado da categoria, numa parcela
//   3. o nome que já existe como receita e o "É transferência › Para alguém do lar"
//   4. Editar conta (modal pelo menu ⋯) e Editar categoria (o link do seletor)
import { randomUUID } from "node:crypto";
import { expect, type Page } from "@playwright/test";
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

const PASSWORD = "frase longa da pessoa das transferencias";

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

/** Um recebido do banco, como a busca grava. */
async function received(input: {
  householdId: string;
  walletId: string;
  accountId: string;
  method: "PIX" | "CREDIT";
  amount: string;
  occurredOn: string;
  description: string;
  installment?: [number, number];
}) {
  const [row] = await sql<{ id: string }>(
    `INSERT INTO "transaction" (id, "householdId", "walletId", "accountId", method, amount, "occurredOn",
       description, status, source, "externalId", "providerInstallmentNumber", "providerInstallmentCount", "updatedAt")
     VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, 'PENDING', 'OPEN_FINANCE', $8, $9, $10, now())
     RETURNING id`,
    [
      input.householdId,
      input.walletId,
      input.accountId,
      input.method,
      input.amount,
      input.occurredOn,
      input.description,
      `e2e-${randomUUID()}`,
      input.installment?.[0] ?? null,
      input.installment?.[1] ?? null,
    ],
  );
  return row!.id;
}

const rowOf = async (id: string) =>
  (
    await sql<{ status: string; transferId: string | null; label: string | null }>(
      'SELECT status, "transferId", label FROM "transaction" WHERE id = $1',
      [id],
    )
  )[0]!;

const toast = (page: Page, text: RegExp) =>
  page.locator("[data-sonner-toast]").filter({ hasText: text });

test("transferência, O que foi, É transferência, Editar conta e Editar categoria", async ({
  page,
}, testInfo) => {
  test.slow(); // várias telas e ações
  const email = testEmail("transferencias", testInfo.project.name);
  await createTestUser(page.request, {
    email,
    password: PASSWORD,
    name: "Lia Transferência",
    twoFactor: true,
  });
  const { householdId, personal } = await createHouseholdDirect({
    name: "Lar das transferências",
    people: [{ email, role: "OWNER" }],
  });
  created.push(householdId);
  const walletId = personal[email]!;
  const { accounts, categories } = await createFinanceDirect({
    householdId,
    accounts: [
      { walletId, name: "Conta", kind: "CHECKING", holderEmail: email },
      { walletId, name: "Poupança", kind: "SAVINGS", holderEmail: email },
      {
        walletId,
        name: "Mastercard",
        kind: "CREDIT_CARD",
        holderEmail: email,
        closingDay: 3,
        dueDay: 9,
        cards: [{ nickname: "Master Lia", lastFour: "0001", holderEmail: email }],
      },
    ],
    categories: [
      { name: "Vestuário", kind: "EXPENSE" },
      { name: "Escola", kind: "INCOME" },
    ],
  });
  const base = { householdId, walletId };
  const out = await received({
    ...base,
    accountId: accounts.Conta!.id,
    method: "PIX",
    amount: "-500.00",
    occurredOn: daysAgo(2),
    description: "TRANSF ENVIADA POUPANCA",
  });
  const into = await received({
    ...base,
    accountId: accounts["Poupança"]!.id,
    method: "PIX",
    amount: "500.00",
    occurredOn: daysAgo(2),
    description: "APLICACAO POUPANCA",
  });
  const parcel = await received({
    ...base,
    accountId: accounts.Mastercard!.id,
    method: "CREDIT",
    amount: "-97.64",
    occurredOn: daysAgo(3),
    description: "MERCADOLIVRE*MERCA03/03",
    installment: [3, 3],
  });
  const pix = await received({
    ...base,
    accountId: accounts.Conta!.id,
    method: "PIX",
    amount: "-800.00",
    occurredOn: daysAgo(4),
    description: "PIX ENVIADO PARCEIRA",
  });

  // ── 1. A transferência sugerida ──
  await openPage(page, "/lancamentos/recebidos");
  const transfer = page.getByTestId("transferencia-sugerida");
  await expect(transfer).toHaveCount(1);
  await expect(transfer).toContainText("Conta");
  await expect(transfer).toContainText("Poupança");
  await expectNoA11yViolations(page);
  await transfer.getByRole("button", { name: "Confirmar transferência" }).click();
  await expect(toast(page, /Transferência ligada/)).toBeVisible();
  const [a, b] = [await rowOf(out), await rowOf(into)];
  expect(a.transferId).not.toBeNull();
  expect([a.status, b.status, b.transferId]).toEqual(["CONFIRMED", "CONFIRMED", a.transferId]);
  await toast(page, /Transferência ligada/)
    .getByRole("button", { name: "Desfazer" })
    .click();
  await expect.poll(async () => (await rowOf(out)).status).toBe("PENDING");
  expect((await rowOf(into)).transferId).toBeNull();
  await openPage(page, "/lancamentos/recebidos");
  await page
    .getByTestId("transferencia-sugerida")
    .getByRole("button", { name: "Confirmar transferência" })
    .click();
  await expect(toast(page, /Transferência ligada/)).toBeVisible();
  await expect(page.getByTestId("transferencia-sugerida")).toHaveCount(0);

  // ── 2. O que foi numa parcela (a página de novo: sem o aviso de antes por cima) ──
  await openPage(page, "/lancamentos/recebidos");
  const parcelRow = page.getByTestId("recebido").filter({ hasText: "MERCADOLIVRE*MERCA03/03" });
  await parcelRow.getByText("O que foi", { exact: true }).filter({ visible: true }).click();
  const labelDialog = page.getByRole("dialog", { name: /O que foi MERCADOLIVRE/ });
  await expect(labelDialog).toBeVisible();
  await expect(labelDialog).toContainText("Vale para as 3 parcelas desta compra");
  await expectNoA11yViolations(page);
  await labelDialog.getByRole("textbox", { name: "O que foi" }).fill("Sapato da Zara");
  await labelDialog.getByRole("button", { name: "Salvar" }).click();
  await expect(parcelRow.getByText("Sapato da Zara").first()).toBeVisible();
  expect((await rowOf(parcel)).label).toBe("Sapato da Zara");

  // ── 3. O nome que já existe como receita, e "É transferência" ──
  const pixRow = page.getByTestId("recebido").filter({ hasText: "PIX ENVIADO PARCEIRA" });
  await pixRow.getByText("Escolher categoria").filter({ visible: true }).click();
  const picker = page.getByRole("dialog", { name: /Categoria.*PIX ENVIADO PARCEIRA/ });
  await picker.getByRole("searchbox").fill("escola");
  await expect(picker.getByTestId("categoria-outro-tipo")).toContainText(
    "“Escola” já existe como receita",
  );
  await expect(picker.getByRole("button", { name: /Criar/ })).toHaveCount(0);
  await expectNoA11yViolations(page);
  await picker.getByRole("button", { name: "Para alguém do lar" }).click();
  await expect(pixRow).toContainText("para alguém do lar");
  const marked = await sql<{ transferPeer: string | null; transferId: string | null }>(
    'SELECT "transferPeer", "transferId" FROM "transaction" WHERE id = $1',
    [pix],
  );
  expect(marked[0]!.transferPeer).toBe("HOUSEHOLD");
  expect(marked[0]!.transferId).not.toBeNull();

  // ── 4a. Editar conta (o modal pelo menu ⋯) ──
  await openPage(page, "/ajustes/contas");
  await page.getByRole("button", { name: "Opções da conta Conta" }).click();
  await page.getByRole("link", { name: "Editar a conta Conta" }).click();
  await page.waitForURL(`**/ajustes/contas/${accounts.Conta!.id}/editar`);
  const accountDialog = page.getByRole("dialog", { name: "Editar conta" });
  await expect(accountDialog).toBeVisible();
  await expectNoA11yViolations(page);
  await accountDialog.getByLabel("Apelido").fill("Aurora · Conta corrente");
  await accountDialog.getByText("Poupança", { exact: true }).click();
  await page.getByRole("button", { name: "Salvar" }).filter({ visible: true }).click();
  await page.waitForURL(/\/ajustes\/contas\?editada=/);
  await expect(page.getByTestId("aviso-criado")).toContainText(
    "Conta “Aurora · Conta corrente” atualizada.",
  );
  const account = await sql<{ name: string; kind: string }>(
    "SELECT name, kind FROM financial_account WHERE id = $1",
    [accounts.Conta!.id],
  );
  expect(account[0]).toEqual({ name: "Aurora · Conta corrente", kind: "SAVINGS" });

  // ── 4b. Editar categoria: a Escola vira despesa (sem lançamentos de entrada) ──
  await openPage(page, `/ajustes/categorias/${categories.Escola!}`);
  await expect(page.getByRole("heading", { level: 1, name: "Editar categoria" })).toBeVisible();
  await page.getByText("Despesa", { exact: true }).click();
  await page.getByRole("button", { name: "Salvar" }).filter({ visible: true }).click();
  await page.waitForURL(/\/ajustes\/categorias\?editada=/);
  await expect(page.getByTestId("aviso-criado")).toContainText("Categoria “Escola” atualizada.");
  const escola = await sql<{ kind: string }>("SELECT kind FROM category WHERE id = $1", [
    categories.Escola!,
  ]);
  expect(escola[0]!.kind).toBe("EXPENSE");
});
