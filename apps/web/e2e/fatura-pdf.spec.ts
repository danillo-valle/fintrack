// A fatura do cartão em PDF (M09.4) de ponta a ponta, com o serviço Python de verdade e os PDFs
// SINTÉTICOS de samples/pdf/ (gerados por services/ml/scripts/gerar_faturas.py). Cada aparelho
// usa uma pessoa e um lar próprios.
//
//   1. o PDF com senha: o passo da senha, a senha errada, a certa
//   2. a conferência: o resumo, a fatura que confere ao centavo, 1 já veio pelo Meu Pluggy
//   3. importar: as compras e a fatura; a página do cartão mostra a fatura do PDF
//   4. a fatura que não fecha: o aviso e "Importar mesmo assim"; Cancelar
//   5. o PDF escaneado: a frase do erro, nada gravado
import { randomUUID } from "node:crypto";
import path from "node:path";
import { expect, type Locator } from "@playwright/test";
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
} from "./helpers";

const PASSWORD = "frase longa da pessoa da fatura";
const SAMPLES = path.resolve(process.cwd(), "../../samples/pdf");
const LOCKED = path.join(SAMPLES, "exemplo-visa-0002-senha-1234.pdf");
const OFF = path.join(SAMPLES, "exemplo-visa-0002-nao-confere.pdf");
const SCANNED = path.join(SAMPLES, "escaneada.pdf");
const FILE_LABEL = "Escolha o extrato .ofx ou a fatura .pdf";

// Com Cache Components, a tela anterior fica guardada (escondida) para o "Voltar": as buscas por
// texto, rótulo e test id olham só o que está à vista
const shown = (locator: Locator) => locator.filter({ visible: true });

const created: string[] = [];
test.afterEach(async () => {
  await deleteHouseholds(created.splice(0));
});

test("fatura em PDF: senha, conferência ao centavo, importar e a que não fecha", async ({
  page,
}, testInfo) => {
  test.slow(); // três PDFs lidos pelo serviço Python
  const email = testEmail("fatura-pdf", testInfo.project.name);
  await createTestUser(page.request, {
    email,
    password: PASSWORD,
    name: "Rui Fatura",
    twoFactor: true,
  });
  const { householdId, personal } = await createHouseholdDirect({
    name: "Lar da fatura",
    people: [{ email, role: "OWNER" }],
  });
  created.push(householdId);
  const walletId = personal[email]!;
  const { accounts } = await createFinanceDirect({
    householdId,
    accounts: [
      {
        walletId,
        name: "Visa Exemplo",
        kind: "CREDIT_CARD",
        holderEmail: email,
        closingDay: 1,
        dueDay: 10,
        cards: [{ nickname: "Visa Rui", lastFour: "0002", holderEmail: email }],
      },
    ],
  });
  const cardId = accounts["Visa Exemplo"]!.id;
  // O posto já veio pelo Meu Pluggy (mesmo valor e mesma data)
  await sql(
    `INSERT INTO "transaction" (id, "householdId", "walletId", "accountId", method, amount, "occurredOn",
       description, status, source, "externalId", "updatedAt")
     VALUES (gen_random_uuid(), $1, $2, $3, 'CREDIT', '-88.40', '2026-10-04', 'POSTO ESTRELA',
       'PENDING', 'OPEN_FINANCE', $4, now())`,
    [householdId, walletId, cardId, `e2e-${randomUUID()}`],
  );
  const fromPdf = async () =>
    (
      await sql<{ n: string }>(
        `SELECT count(*)::text AS n FROM "transaction" WHERE "householdId" = $1 AND source = 'PDF'`,
        [householdId],
      )
    )[0]!.n;

  // ── 1. O PDF com senha ──
  await openPage(page, "/lancamentos/importar");
  await expect(page.getByRole("heading", { level: 1, name: "Importar extrato" })).toBeVisible();
  await shown(page.getByLabel(FILE_LABEL)).setInputFiles(LOCKED);
  const step = shown(page.getByTestId("passo-senha"));
  await expect(step.getByRole("heading", { name: "Este PDF tem senha" })).toBeVisible();
  await expect(step).toContainText("exemplo-visa-0002-senha-1234.pdf");
  await expect(step).toContainText("protegido por senha");
  await expectNoA11yViolations(page);
  const password = shown(page.getByLabel("Senha do PDF"));
  await expect(password).toHaveAttribute("autocomplete", "off");
  await password.fill("0000");
  await page.getByRole("button", { name: "Abrir e conferir" }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "A senha não abriu o PDF" }),
  ).toBeVisible();
  await shown(page.getByLabel("Senha do PDF")).fill("1234");
  await page.getByRole("button", { name: "Abrir e conferir" }).click();
  await page.waitForURL(/\/lancamentos\/importar\/[0-9a-f-]{36}/);

  // ── 2. A conferência ──
  await expect(shown(page.getByTestId("resumo-arquivo"))).toHaveText(
    "Banco Exemplo · cartão final 0002 · vence 10/11/2026",
  );
  await expect(
    shown(page.getByText("lido pelo perfil Banco Exemplo", { exact: false })),
  ).toBeVisible();
  await expect(shown(page.getByLabel("Entra na conta"))).toHaveValue(cardId);
  const invoice = shown(page.getByTestId("fatura-conferida"));
  await expect(invoice).toContainText("Confere ao centavo");
  await expect(shown(page.getByTestId("fatura-total-pdf"))).toHaveText("R$ 2.093,51");
  await expect(invoice).toContainText("R$ 2.050,00");
  await expect(invoice).toContainText("R$ 314,03");
  await expect(shown(page.getByTestId("contagem-novos"))).toContainText("9");
  await expect(shown(page.getByTestId("contagem-pluggy"))).toContainText("1");
  // O celular mostra só as 5 linhas mais novas; o posto (04/10) aparece no computador
  if (testInfo.project.name === "desktop") {
    await expect(
      shown(page.getByTestId("linha-arquivo").filter({ hasText: "POSTO ESTRELA" })),
    ).toContainText("Já veio pelo Meu Pluggy");
  }
  await expectNoA11yViolations(page);

  // ── 3. Importar: as compras e a fatura ──
  await page.getByRole("button", { name: "Importar 9 lançamentos e a fatura" }).click();
  await page.waitForURL(/\/lancamentos\/importar\?importado=/);
  await expect(shown(page.getByTestId("resultado-importacao"))).toContainText(
    "9 entraram · 1 já vinha do Meu Pluggy · fatura confere",
  );
  await expect(shown(page.getByTestId("arquivos-importados"))).toContainText("vence 10/11");
  expect(await fromPdf()).toBe("9");
  const statements = await sql<{ source: string; total: string; linked: string }>(
    `SELECT s.source::text, s.total::text,
       (SELECT count(*)::text FROM "transaction" t WHERE t."statementId" = s.id) AS linked
     FROM card_statement s WHERE s."accountId" = $1`,
    [cardId],
  );
  expect(statements).toEqual([{ source: "PDF", total: "2093.51", linked: "10" }]);
  // Nada da senha guardado: nem no arquivo importado, nem na auditoria
  const leaks = await sql<{ n: string }>(
    `SELECT count(*)::text AS n FROM audit_log WHERE "householdId" = $1 AND metadata::text LIKE '%1234%'`,
    [householdId],
  );
  expect(leaks[0]!.n).toBe("0");

  await openPage(page, `/carteiras/conta/${cardId}`);
  await expect(shown(page.getByText("Da fatura em PDF", { exact: false }))).toBeVisible();
  await expect(shown(page.getByTestId("fatura-total"))).toHaveText("R$ 2.093,51");
  await expect(shown(page.getByTestId("fatura-confere"))).toContainText("dão o total da fatura");

  // ── 4. A fatura que não fecha ──
  await openPage(page, "/lancamentos/importar");
  await shown(page.getByLabel(FILE_LABEL)).setInputFiles(OFF);
  await page.waitForURL(/\/lancamentos\/importar\/[0-9a-f-]{36}/);
  await expect(shown(page.getByTestId("aviso-nao-confere"))).toContainText("faltam R$ 12,40");
  await expect(shown(page.getByTestId("fatura-conferida"))).toContainText("Faltam R$ 12,40");
  await expect(page.getByRole("button", { name: "Importar mesmo assim" })).toBeVisible();
  await expectNoA11yViolations(page);
  await page.getByRole("button", { name: "Cancelar" }).click();
  await page.waitForURL(/\/lancamentos\/importar$/);

  // ── 5. O PDF escaneado ──
  await shown(page.getByLabel(FILE_LABEL)).setInputFiles(SCANNED);
  await expect(page.getByRole("alert").filter({ hasText: "Esse PDF é uma imagem" })).toBeVisible();
  expect(await fromPdf()).toBe("9");
});
