// Importar extrato (M09.3) de ponta a ponta, com os arquivos SINTÉTICOS de samples/ofx/
// (escritos à mão). Cada aparelho usa uma pessoa e um lar próprios.
//
//   1. o extrato da conta: enviar, conferir (2 já vieram pelo Meu Pluggy) e importar
//   2. o mesmo arquivo de novo: o aviso, nada novo; "Cancelar" apaga a conferência
//   3. a fatura do cartão: a conta sugerida pelo final 0002 e a nota do cartão
//   4. um arquivo que não é OFX: a frase do erro, nada gravado
//   5. outra pessoa abre a conferência: 404
import { randomUUID } from "node:crypto";
import path from "node:path";
import { expect, type Locator } from "@playwright/test";
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
} from "./helpers";

const PASSWORD = "frase longa da pessoa do extrato";
const SAMPLES = path.resolve(process.cwd(), "../../samples/ofx");
const AURORA = path.join(SAMPLES, "aurora-conta-4321.ofx");
const VISA = path.join(SAMPLES, "exemplo-visa-0002.ofx");

// Com Cache Components, a tela anterior fica guardada (escondida) para o "Voltar": as buscas por
// texto, rótulo e test id olham só o que está à vista
const shown = (locator: Locator) => locator.filter({ visible: true });

const created: string[] = [];
test.afterEach(async () => {
  await deleteHouseholds(created.splice(0));
});

test("importar extrato: conta, arquivo repetido, cartão, erro e acesso", async ({
  page,
  browser,
}, testInfo) => {
  test.slow(); // dois arquivos, duas conferências e o envio repetido
  const email = testEmail("extrato", testInfo.project.name);
  await createTestUser(page.request, {
    email,
    password: PASSWORD,
    name: "Lia Extrato",
    twoFactor: true,
  });
  const { householdId, personal } = await createHouseholdDirect({
    name: "Lar do extrato",
    people: [{ email, role: "OWNER" }],
  });
  created.push(householdId);
  const walletId = personal[email]!;
  const { accounts } = await createFinanceDirect({
    householdId,
    accounts: [
      { walletId, name: "Conta corrente Aurora", kind: "CHECKING", holderEmail: email },
      {
        walletId,
        name: "Visa Exemplo",
        kind: "CREDIT_CARD",
        holderEmail: email,
        closingDay: 5,
        dueDay: 12,
        cards: [{ nickname: "Visa Lia", lastFour: "0002", holderEmail: email }],
      },
    ],
  });
  const checkingId = accounts["Conta corrente Aurora"]!.id;
  // Dois lançamentos do arquivo já vieram pelo Meu Pluggy (mesmo valor e mesma data)
  for (const [amount, day, description] of [
    ["-189.90", "2026-10-04", "BOLETO ENERGIA"],
    ["8450.00", "2026-10-05", "SALARIO EMPRESA EXEMPLO"],
  ] as const) {
    await sql(
      `INSERT INTO "transaction" (id, "householdId", "walletId", "accountId", method, amount, "occurredOn",
         description, status, source, "externalId", "updatedAt")
       VALUES (gen_random_uuid(), $1, $2, $3, 'DEBIT', $4, $5, $6, 'PENDING', 'OPEN_FINANCE', $7, now())`,
      [householdId, walletId, checkingId, amount, day, description, `e2e-${randomUUID()}`],
    );
  }
  const fromFile = async () =>
    (
      await sql<{ n: string }>(
        `SELECT count(*)::text AS n FROM "transaction" WHERE "householdId" = $1 AND source = 'OFX'`,
        [householdId],
      )
    )[0]!.n;

  // ── 1. O extrato da conta ──
  await openPage(page, "/lancamentos/importar");
  await expect(page.getByRole("heading", { level: 1, name: "Importar extrato" })).toBeVisible();
  await expectNoA11yViolations(page);
  await shown(page.getByLabel("Escolha o extrato .ofx ou a fatura .pdf")).setInputFiles(AURORA);
  await page.waitForURL(/\/lancamentos\/importar\/[0-9a-f-]{36}/);
  const conferUrl = page.url();
  await expect(shown(page.getByTestId("resumo-arquivo"))).toHaveText(
    "Banco Aurora · conta final 4321 · 26/09 a 10/10/2026",
  );
  await expect(shown(page.getByLabel("Entra na conta"))).toHaveValue(checkingId);
  await expect(shown(page.getByTestId("contagem-novos"))).toContainText("9");
  await expect(shown(page.getByTestId("contagem-pluggy"))).toContainText("2");
  await expect(shown(page.getByTestId("contagem-importados"))).toContainText("0");
  await expect(
    shown(page.getByTestId("linha-arquivo").filter({ hasText: "BOLETO ENERGIA" })),
  ).toContainText("Já veio pelo Meu Pluggy");
  await expectNoA11yViolations(page);
  await page.getByRole("button", { name: "Importar 9 lançamentos" }).click();
  await page.waitForURL(/\/lancamentos\/importar\?importado=/);
  await expect(shown(page.getByTestId("resultado-importacao"))).toContainText(
    "aurora-conta-4321.ofx importado: 9 entraram · 2 já vinham do Meu Pluggy",
  );
  await expect(shown(page.getByTestId("arquivos-importados"))).toContainText(
    "Conta corrente Aurora",
  );
  expect(await fromFile()).toBe("9");

  // ── 2. O mesmo arquivo de novo: o aviso e nada novo; Cancelar ──
  await shown(page.getByLabel("Escolha o extrato .ofx ou a fatura .pdf")).setInputFiles(AURORA);
  await page.waitForURL(/\/lancamentos\/importar\/[0-9a-f-]{36}/);
  await expect(shown(page.getByTestId("aviso-repetido"))).toContainText(
    "Este arquivo já foi importado",
  );
  await expect(shown(page.getByTestId("contagem-novos"))).toContainText("0");
  await expect(shown(page.getByTestId("contagem-importados"))).toContainText("9");
  const repeatedId = page.url().split("/").pop()!.split("?")[0]!;
  await page.getByRole("button", { name: "Cancelar" }).click();
  await page.waitForURL(/\/lancamentos\/importar$/);
  const left = await sql<{ n: string }>(
    `SELECT count(*)::text AS n FROM file_import WHERE id = $1`,
    [repeatedId],
  );
  expect(left[0]!.n).toBe("0");

  // ── 3. A fatura do cartão ──
  await shown(page.getByLabel("Escolha o extrato .ofx ou a fatura .pdf")).setInputFiles(VISA);
  await page.waitForURL(/\/lancamentos\/importar\/[0-9a-f-]{36}/);
  await expect(shown(page.getByTestId("resumo-arquivo"))).toContainText("cartão final 0002");
  await expect(shown(page.getByLabel("Entra na conta"))).toHaveValue(accounts["Visa Exemplo"]!.id);
  await expect(shown(page.getByText("sugerida pelo final do cartão (0002)"))).toBeVisible();
  await expect(
    shown(page.getByText("O número inteiro do cartão que o arquivo traz é descartado.")),
  ).toBeVisible();
  await page.getByRole("button", { name: "Importar 6 lançamentos" }).click();
  await page.waitForURL(/\/lancamentos\/importar\?importado=/);
  await expect(shown(page.getByTestId("resultado-importacao"))).toContainText("6 entraram");
  expect(await fromFile()).toBe("15");

  // ── 4. Um arquivo que não é OFX ──
  await shown(page.getByLabel("Escolha o extrato .ofx ou a fatura .pdf")).setInputFiles({
    name: "planilha.ofx",
    mimeType: "application/x-ofx",
    buffer: Buffer.from("data;descricao;valor\n01/10/2026;CAFE;-3,00\n"),
  });
  await expect(
    page.getByRole("alert").filter({ hasText: "Esse arquivo não é um extrato OFX" }),
  ).toBeVisible();
  expect(await fromFile()).toBe("15");

  // ── 5. Outra pessoa (a Ana) abre a conferência: 404 ──
  await shown(page.getByLabel("Escolha o extrato .ofx ou a fatura .pdf")).setInputFiles(AURORA);
  await page.waitForURL(/\/lancamentos\/importar\/[0-9a-f-]{36}/);
  const ana = await browser.newContext({ storageState: AUTH_FILE });
  const anaPage = await ana.newPage();
  await openPage(anaPage, page.url());
  await expect(anaPage.getByRole("heading", { name: "Esta página não existe" })).toBeVisible();
  expect(await anaPage.content()).not.toContain("Banco Aurora");
  await ana.close();
  expect(conferUrl).not.toBe(page.url());
});
