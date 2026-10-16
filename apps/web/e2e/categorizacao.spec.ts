// Categorização inteligente (M10.1, linha F do canvas) de ponta a ponta, com o serviço Python de
// verdade (o classificador treina e responde) e dados sintéticos gravados direto no banco. Cada
// aparelho usa uma pessoa e um lar próprios (o modelo é por carteira: nada se mistura).
//
//   1. Recebidos: a etiqueta diz quem sugeriu (Regra, Banco 80 %); "Por que?" explica camada por
//      camada; "Treinar agora" treina o classificador e preenche o que estava sem categoria;
//      "Confirmar Restaurantes" no modal confirma e oferece o "Desfazer"
//   2. Ajustes › Categorização: o percentual sem IA, e cada número leva à lista que o compõe
import { randomUUID } from "node:crypto";
import { expect, type Page } from "@playwright/test";
import {
  clickAndWait,
  createFinanceDirect,
  createHouseholdDirect,
  createTestUser,
  deleteHouseholds,
  expectNoA11yViolations,
  openPage,
  pageData,
  serverAction,
  sql,
  test,
  testEmail,
  todaySaoPaulo,
  waitForReady,
} from "./helpers";

const PASSWORD = "frase longa da pessoa da categorizacao";

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

async function household(testInfo: { project: { name: string } }, page: Page, slug: string) {
  const email = testEmail(slug, testInfo.project.name);
  await createTestUser(page.request, { email, password: PASSWORD, name: "Lia", twoFactor: true });
  const { householdId, personal } = await createHouseholdDirect({
    name: "Lar da categorização",
    people: [{ email, role: "OWNER" }],
  });
  created.push(householdId);
  return { email, householdId, walletId: personal[email]! };
}

/** Um recebido do banco, como a busca grava, com a camada que decidiu (se houver). */
async function received(input: {
  householdId: string;
  walletId: string;
  accountId: string;
  description: string;
  amount: string;
  categoryId?: string | null;
  categorizedBy?: "RULE" | "PROVIDER" | null;
  confidence?: number | null;
  providerCategory?: string | null;
}) {
  const [row] = await sql<{ id: string }>(
    `INSERT INTO "transaction" (id, "householdId", "walletId", "accountId", method, "categoryId",
       "categorizedBy", "categorizationConfidence", amount, "occurredOn", description, status,
       source, "externalId", "providerCategory", "updatedAt")
     VALUES (gen_random_uuid(), $1, $2, $3, 'PIX', $4, $5, $6, $7, $8, $9, 'PENDING',
       'OPEN_FINANCE', $10, $11, now())
     RETURNING id`,
    [
      input.householdId,
      input.walletId,
      input.accountId,
      input.categoryId ?? null,
      input.categorizedBy ?? null,
      input.confidence ?? null,
      input.amount,
      daysAgo(1),
      input.description,
      `e2e-${randomUUID()}`,
      input.providerCategory ?? null,
    ],
  );
  return row!.id;
}

const rowOf = (page: Page, description: string) =>
  page.getByTestId("recebido").filter({ visible: true, hasText: description });

test("recebidos: quem sugeriu, por quê, treinar agora e confirmar pelo modal", async ({
  page,
}, testInfo) => {
  test.slow(); // treino de verdade no serviço Python e três telas
  const { householdId, walletId } = await household(testInfo, page, "categ-recebidos");
  // O histórico confirmado da carteira: 12 do sushi (Restaurantes) e 12 do posto (Combustível)
  const history = Array.from({ length: 12 }, (_, i) => [
    {
      walletId,
      account: "Conta Aurora",
      amount: "-58.90",
      occurredOn: daysAgo(40 + i),
      description: `SUSHI KAIZEN LJ ${1000 + i}`,
      category: "Restaurantes",
    },
    {
      walletId,
      account: "Conta Aurora",
      amount: "-150.00",
      occurredOn: daysAgo(40 + i),
      description: `POSTO ESTRELA ${String(i + 1).padStart(2, "0")}/09`,
      category: "Combustível",
    },
  ]).flat();
  const { accounts, categories } = await createFinanceDirect({
    householdId,
    accounts: [{ walletId, name: "Conta Aurora", kind: "CHECKING" }],
    categories: [
      { name: "Mercado", kind: "EXPENSE" },
      { name: "Restaurantes", kind: "EXPENSE" },
      { name: "Combustível", kind: "EXPENSE" },
      { name: "Farmácia", kind: "EXPENSE" },
    ],
    transactions: history,
  });
  const accountId = accounts["Conta Aurora"]!.id;
  await received({
    householdId,
    walletId,
    accountId,
    description: "SUPERMERC BOM PRECO",
    amount: "-312.48",
    categoryId: categories["Mercado"],
    categorizedBy: "RULE",
    confidence: 100,
  });
  await received({
    householdId,
    walletId,
    accountId,
    description: "FARMACIA CENTRAL",
    amount: "-47.90",
    categoryId: categories["Farmácia"],
    categorizedBy: "PROVIDER",
    confidence: 80,
    providerCategory: "Farmácia",
  });
  // O histórico não reconhece "SUSHI KAIZEN SHOPPING" (outra chave de comerciante); o
  // classificador, treinado com o sushi da loja 1000 a 1011, reconhece
  const sushi = await received({
    householdId,
    walletId,
    accountId,
    description: "SUSHI KAIZEN SHOPPING",
    amount: "-96.00",
  });

  // 1. As etiquetas: o texto diz a camada (e a confiança), não só a cor
  await openPage(page, "/lancamentos/recebidos");
  await expect(rowOf(page, "SUPERMERC BOM PRECO").locator("[data-slot=source-pill]")).toHaveText(
    "sugerida por Regra",
  );
  await expect(rowOf(page, "FARMACIA CENTRAL").locator("[data-slot=source-pill]")).toHaveText(
    "sugerida por Banco, confiança de 80 %",
  );
  await expect(rowOf(page, "SUSHI KAIZEN SHOPPING").getByText("Escolher categoria")).toBeVisible();

  // 2. "Por que?" antes do treino: nenhuma camada sugeriu, e o classificador ainda não tem modelo
  // O modal é uma navegação do Next: espera a resposta da rota (não o relógio, regra do M10.0)
  const whyPath = `/lancamentos/recebidos/por-que/${sushi}` as const;
  await clickAndWait(
    rowOf(page, "SUSHI KAIZEN SHOPPING").getByRole("link", {
      name: "Por que essa categoria: SUSHI KAIZEN SHOPPING",
    }),
    pageData(whyPath),
  );
  const dialog = page.getByRole("dialog", { name: "Por que ficou sem categoria?" });
  await expect(dialog).toBeVisible();
  const steps = dialog.getByRole("list", { name: "As camadas da cascata, em ordem" });
  await expect(steps.getByRole("listitem")).toHaveCount(4);
  await expect(steps.getByRole("listitem").nth(3)).toContainText(
    "Ainda sem modelo treinado nas carteiras que você vê",
  );
  await expectNoA11yViolations(page);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();

  // 3. Treinar agora (Ajustes › Categorização): 1 carteira treinada, o sushi ganha categoria
  await openPage(page, "/ajustes/categorizacao");
  await clickAndWait(page.getByRole("button", { name: "Treinar agora" }), serverAction);
  await expect(
    page.getByText("Treino feito: 1 carteira treinada, 1 recebido ganhou categoria."),
  ).toBeVisible();
  const [filled] = await sql<{ categorizedBy: string; categorizationConfidence: number }>(
    `SELECT "categorizedBy", "categorizationConfidence" FROM "transaction" WHERE id = $1`,
    [sushi],
  );
  expect(filled).toMatchObject({ categorizedBy: "CLASSIFIER" });
  expect(filled!.categorizationConfidence).toBeGreaterThanOrEqual(80);

  // 4. De volta aos recebidos: Restaurantes, sugerida pelo classificador, com a confiança
  await openPage(page, "/lancamentos/recebidos");
  const pill = rowOf(page, "SUSHI KAIZEN SHOPPING").locator("[data-slot=source-pill]");
  await expect(pill).toHaveText(
    `sugerida por Classificador, confiança de ${filled!.categorizationConfidence} %`,
  );
  await clickAndWait(
    rowOf(page, "SUSHI KAIZEN SHOPPING").getByRole("link", {
      name: "Por que essa categoria: SUSHI KAIZEN SHOPPING",
    }),
    pageData(whyPath),
  );
  const why = page.getByRole("dialog", { name: "Por que Restaurantes?" });
  await expect(why).toBeVisible();
  const decided = why.locator("li[data-state=DECIDED]");
  await expect(decided).toHaveCount(1);
  await expect(decided).toContainText("4 · Classificador");
  await expect(decided).toContainText("Decidiu");
  await expect(decided).toContainText("(sugere a partir de 80 %)");

  // 5. Confirmar pelo modal: volta à lista, o recebido sai e o aviso oferece o Desfazer
  await clickAndWait(why.getByRole("button", { name: "Confirmar Restaurantes" }), serverAction);
  await page.waitForURL("**/lancamentos/recebidos");
  await waitForReady(page);
  await expect(
    page
      .locator("[data-sonner-toast]")
      .filter({ hasText: "1 recebido confirmado. Já entra nas somas." }),
  ).toBeVisible();
  await expect(rowOf(page, "SUSHI KAIZEN SHOPPING")).toHaveCount(0);
  const [status] = await sql<{ status: string; categorizedBy: string }>(
    `SELECT status, "categorizedBy" FROM "transaction" WHERE id = $1`,
    [sushi],
  );
  expect(status).toEqual({ status: "CONFIRMED", categorizedBy: "CLASSIFIER" });
});

test("Ajustes › Categorização: o percentual sem IA e cada número leva à lista", async ({
  page,
}, testInfo) => {
  const { householdId, walletId } = await household(testInfo, page, "categ-medida");
  const { accounts, categories } = await createFinanceDirect({
    householdId,
    accounts: [{ walletId, name: "Conta Aurora", kind: "CHECKING" }],
    categories: [{ name: "Mercado", kind: "EXPENSE" }],
  });
  const add = async (
    description: string,
    categorizedBy: "RULE" | "HISTORY" | "PROVIDER" | "CLASSIFIER" | "MANUAL" | null,
    withCategory = true,
  ) =>
    sql(
      `INSERT INTO "transaction" (id, "householdId", "walletId", "accountId", method, "categoryId",
         "categorizedBy", amount, "occurredOn", description, "updatedAt")
       VALUES (gen_random_uuid(), $1, $2, $3, 'PIX', $4, $5, '-10.00', $6, $7, now())`,
      [
        householdId,
        walletId,
        accounts["Conta Aurora"]!.id,
        withCategory ? categories["Mercado"] : null,
        categorizedBy,
        daysAgo(3),
        description,
      ],
    );
  await add("REGRA UM", "RULE");
  await add("REGRA DOIS", "RULE");
  await add("HISTORICO UM", "HISTORY");
  await add("BANCO UM", "PROVIDER");
  await add("CLASSIFICADOR UM", "CLASSIFIER");
  await add("CLASSIFICADOR DOIS", "CLASSIFIER");
  await add("VOCE UM", "MANUAL");
  await add("SEM CATEGORIA", null, false);

  await openPage(page, "/ajustes/categorizacao");
  await expect(page.getByTestId("percentual-sem-ia")).toHaveText("75,0 %");
  await expect(page.getByText(/6 de 8 lançamentos dos últimos 30 dias/)).toBeVisible();
  await expect(page.getByTestId("camada-CLASSIFIER")).toContainText("25,0 %");
  await expectNoA11yViolations(page);
  // No celular, nada passa da largura da tela
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);

  // O "2" do classificador leva à lista dos 2, com o filtro à vista e o caminho de volta
  await page.getByRole("link", { name: "2 lançamentos: Classificador" }).click();
  await page.waitForURL(/\/lancamentos\?.*quem=classificador/);
  await waitForReady(page);
  await expect(page.getByText("CLASSIFICADOR UM").filter({ visible: true })).toBeVisible();
  await expect(page.getByText("CLASSIFICADOR DOIS").filter({ visible: true })).toBeVisible();
  await expect(page.getByText("REGRA UM").filter({ visible: true })).toHaveCount(0);
  await expect(page.getByRole("link", { name: /Categorização/ }).first()).toBeVisible();
});
