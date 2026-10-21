// A IA local (M10.2b, ADR-016, linha F.2 do canvas) de ponta a ponta. O llama-server não roda
// no teste: o que ele responderia à noite é gravado direto no banco (local_ai_attempt), com dados
// sintéticos. O que se testa é a tela: o interruptor, a fila, a categoria da IA fora do lote, a
// proposta de categoria nova com o "Criar e aplicar", e a 5ª camada do "Por que".
//
//   1. Ajustes › Categorização: o cartão IA local começa desligado; o interruptor liga
//   2. Recebidos: a aba "Na fila da IA", a categoria da IA fora do "Confirmar os N", a proposta
//   3. "Criar e aplicar": cria Academia em Saúde e aplica nos 2 recebidos com a mesma proposta;
//      eles continuam pendentes, esperando o Confirmar
//   4. "Por que": a 5ª camada, IA local, decidiu
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

const PASSWORD = "frase longa da pessoa da ia local";

const created: string[] = [];
test.afterEach(async () => {
  await deleteHouseholds(created.splice(0));
});

async function household(testInfo: { project: { name: string } }, page: Page, slug: string) {
  const email = testEmail(slug, testInfo.project.name);
  await createTestUser(page.request, { email, password: PASSWORD, name: "Lia", twoFactor: true });
  const { householdId, personal } = await createHouseholdDirect({
    name: "Lar da IA local",
    people: [{ email, role: "OWNER" }],
  });
  created.push(householdId);
  return { householdId, walletId: personal[email]! };
}

/** Um recebido do Meu Pluggy, como a busca grava (pendente, fora das somas). */
async function received(input: {
  householdId: string;
  walletId: string;
  accountId: string;
  description: string;
  amount: string;
  categoryId?: string | null;
  categorizedBy?: "RULE" | "LLM" | null;
}) {
  const [row] = await sql<{ id: string }>(
    `INSERT INTO "transaction" (id, "householdId", "walletId", "accountId", method, "categoryId",
       "categorizedBy", amount, "occurredOn", description, status, source, "externalId",
       "updatedAt")
     VALUES (gen_random_uuid(), $1, $2, $3, 'PIX', $4, $5, $6, $7, $8, 'PENDING',
       'OPEN_FINANCE', $9, now())
     RETURNING id`,
    [
      input.householdId,
      input.walletId,
      input.accountId,
      input.categoryId ?? null,
      input.categorizedBy ?? null,
      input.amount,
      todaySaoPaulo(),
      input.description,
      `e2e-${randomUUID()}`,
    ],
  );
  return row!.id;
}

/** O que a IA local respondeu à noite para um recebido. */
async function attempt(
  householdId: string,
  transactionId: string,
  outcome: "SUGGESTED" | "NEW_CATEGORY",
  proposal: { name: string; parentId: string } | null = null,
) {
  await sql(
    `INSERT INTO local_ai_attempt ("transactionId", "householdId", outcome, "proposedName",
       "proposedParentId")
     VALUES ($1, $2, $3::local_ai_outcome, $4, $5)`,
    [transactionId, householdId, outcome, proposal?.name ?? null, proposal?.parentId ?? null],
  );
}

const rowOf = (page: Page, description: string) =>
  page.getByTestId("recebido").filter({ visible: true, hasText: description });

test("IA local: o interruptor, a fila, criar e aplicar a categoria nova e o Por que", async ({
  page,
}, testInfo) => {
  test.slow(); // três telas e dois modais
  const { householdId, walletId } = await household(testInfo, page, "ia-local");
  const { accounts, categories } = await createFinanceDirect({
    householdId,
    accounts: [{ walletId, name: "Conta Aurora", kind: "CHECKING" }],
    categories: [
      { name: "Saúde", kind: "EXPENSE" },
      { name: "Farmácia", kind: "EXPENSE" },
      { name: "Mercado", kind: "EXPENSE" },
    ],
  });
  await sql(`UPDATE category SET "parentId" = $1 WHERE id = $2`, [
    categories["Saúde"],
    categories["Farmácia"],
  ]);
  const accountId = accounts["Conta Aurora"]!.id;
  const base = { householdId, walletId, accountId };

  // 1. O interruptor: começa desligado; quem mexe nas categorias liga
  await openPage(page, "/ajustes/categorizacao");
  const card = page.getByTestId("cartao-ia-local");
  await expect(card.getByTestId("ia-local-estado")).toHaveText("Desligada");
  const toggle = card.getByRole("switch", { name: "IA local" });
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  await clickAndWait(toggle, serverAction);
  await expect(card.getByTestId("ia-local-estado")).toHaveText(
    /^Ligada desde \d{2}\/\d{2}\/\d{4}$/,
  );
  await expect(card.getByRole("switch", { name: "IA local" })).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await expect(card).toContainText("das 04:45 às 06:45");
  await expectNoA11yViolations(page);
  const [on] = await sql<{ on: boolean }>(
    `SELECT "localAiEnabledAt" IS NOT NULL AS on FROM household WHERE id = $1`,
    [householdId],
  );
  expect(on).toEqual({ on: true });

  // A noite (gravada direto): um recebido ainda na fila, um que a IA categorizou, um da regra e
  // dois em que ela propôs a mesma categoria nova (Academia, em Saúde)
  await received({ ...base, description: "LOJA ALFA ELETRO", amount: "-219.90" });
  const quitanda = await received({
    ...base,
    description: "QUITANDA DO SEU JOAO",
    amount: "-42.30",
    categoryId: categories["Mercado"],
    categorizedBy: "LLM",
  });
  await attempt(householdId, quitanda, "SUGGESTED");
  await received({
    ...base,
    description: "SUPERMERC BOM PRECO",
    amount: "-312.48",
    categoryId: categories["Mercado"],
    categorizedBy: "RULE",
  });
  const proposal = { name: "Academia", parentId: categories["Saúde"]! };
  const academia1 = await received({
    ...base,
    description: "ACADEMIA CORPO FORTE",
    amount: "-119.90",
  });
  await attempt(householdId, academia1, "NEW_CATEGORY", proposal);
  const academia2 = await received({
    ...base,
    description: "ACADEMIA CORPO FORTE PARC 02/12",
    amount: "-119.90",
  });
  await attempt(householdId, academia2, "NEW_CATEGORY", proposal);

  // 2. Recebidos: a etiqueta da IA, a fila, a proposta; o lote deixa a categoria da IA de fora
  await openPage(page, "/lancamentos/recebidos");
  await expect(rowOf(page, "QUITANDA DO SEU JOAO").locator("[data-slot=source-pill]")).toHaveText(
    "sugerida por IA local",
  );
  await expect(rowOf(page, "LOJA ALFA ELETRO").getByTestId("na-fila-ia")).toContainText(
    "Na fila da IA",
  );
  await expect(rowOf(page, "ACADEMIA CORPO FORTE PARC").getByTestId("proposta-ia")).toContainText(
    "Criar “Academia”?",
  );
  await expect(
    page.getByRole("button", { name: "Confirmar o que já tem categoria" }),
  ).toBeVisible();
  await expect(page.getByText("A da IA local você confirma uma a uma")).toBeVisible();
  await expectNoA11yViolations(page);

  await page
    .getByRole("navigation", { name: "Filtrar recebidos" })
    .getByRole("link", { name: /fila da IA/i })
    .click();
  await page.waitForURL(/ver=fila-ia/);
  await waitForReady(page);
  await expect(page.getByTestId("recebido").filter({ visible: true })).toHaveCount(1);
  await expect(rowOf(page, "LOJA ALFA ELETRO")).toHaveCount(1);

  // 3. Criar e aplicar: o modal mostra o nome, a mãe e onde vai entrar
  await openPage(page, "/lancamentos/recebidos");
  const createPath = `/lancamentos/recebidos/criar/${academia2}` as const;
  await clickAndWait(
    rowOf(page, "ACADEMIA CORPO FORTE PARC").getByRole("link", {
      name: "Criar e aplicar Academia: ACADEMIA CORPO FORTE PARC 02/12",
    }),
    pageData(createPath),
  );
  const dialog = page.getByRole("dialog", { name: "Criar a categoria Academia?" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel("Nome")).toHaveValue("Academia");
  await expect(dialog.getByLabel("Dentro de")).toHaveValue(categories["Saúde"]!);
  await expect(dialog).toContainText("Aplica em 2 recebidos com essa proposta");
  await expectNoA11yViolations(page);
  await clickAndWait(dialog.getByRole("button", { name: "Criar e aplicar" }), serverAction);
  await page.waitForURL("**/lancamentos/recebidos");
  await waitForReady(page);
  await expect(
    page
      .locator("[data-sonner-toast]")
      .filter({ hasText: "Categoria aplicada em 2 recebidos. Falta o seu Confirmar." }),
  ).toBeVisible();
  const rows = await sql<{ status: string; categorizedBy: string; name: string; parent: string }>(
    `SELECT t.status, t."categorizedBy", c.name, c."parentId" AS parent
       FROM "transaction" t JOIN category c ON c.id = t."categoryId"
      WHERE t.id = ANY($1::uuid[])`,
    [[academia1, academia2]],
  );
  expect(rows).toHaveLength(2);
  for (const row of rows) {
    expect(row).toEqual({
      status: "PENDING",
      categorizedBy: "LLM",
      name: "Academia",
      parent: categories["Saúde"],
    });
  }
  await expect(rowOf(page, "ACADEMIA CORPO FORTE PARC").getByTestId("proposta-ia")).toHaveCount(0);

  // 4. Por que: a 5ª camada, IA local, decidiu
  await clickAndWait(
    rowOf(page, "QUITANDA DO SEU JOAO").getByRole("link", {
      name: "Por que essa categoria: QUITANDA DO SEU JOAO",
    }),
    pageData(`/lancamentos/recebidos/por-que/${quitanda}`),
  );
  const why = page.getByRole("dialog", { name: "Por que Mercado?" });
  await expect(why).toBeVisible();
  const steps = why.getByRole("list", { name: "As camadas da cascata, em ordem" });
  await expect(steps.getByRole("listitem")).toHaveCount(5);
  const decided = why.locator("li[data-state=DECIDED]");
  await expect(decided).toHaveCount(1);
  await expect(decided).toContainText("5 · IA local");
  await expect(decided).toContainText("Decidiu");
});
