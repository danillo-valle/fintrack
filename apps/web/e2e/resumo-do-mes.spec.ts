// O resumo do mês no Início (M10.3, linha F.3 do canvas) de ponta a ponta, com dados sintéticos
// gravados direto no banco. O mês do resumo segue a mesma regra do app (summaryPeriod): do dia 1
// ao 5, o mês anterior, fechado; depois, o mês corrente. Os dados são montados no mês do resumo,
// então o teste vale em qualquer dia em que rodar.
//
//   1. As três observações na ordem do peso: o orçado que estoura, a conta fixa nova e o
//      "acima do costume"; os números levam às listas com o mesmo total; axe; 320 px
//   2. Só uma observação: a frase do que não apareceu
//   3. Nada fora do costume
import { addMonthsToKey, summaryPeriod, type MonthKey } from "@fintrack/core";
import { expect, type Page, type TestInfo } from "@playwright/test";
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

const PASSWORD = "frase longa da pessoa do resumo do mes";
const period = summaryPeriod(todaySaoPaulo());
const closed = period.mode === "closed";
/** Um dia do mês do resumo que já passou: o 1º no mês corrente (hoje é dia 6 ou depois), o 10 no fechado. */
const day0 = `${period.month}-${closed ? "10" : "01"}`;
const monthName = (key: MonthKey) =>
  new Intl.DateTimeFormat("pt-BR", { month: "long", timeZone: "UTC" }).format(
    new Date(`${key}-15T12:00:00Z`),
  );

const created: string[] = [];
test.afterEach(async () => {
  await deleteHouseholds(created.splice(0));
});

function centsOf(text: string): bigint {
  const match = text.replace(/\s+/g, " ").match(/R\$ ?([\d.]+),(\d{2})/);
  if (!match) throw new Error(`sem valor em "${text}"`);
  return BigInt(match[1]!.replaceAll(".", "") + match[2]!);
}

async function household(testInfo: TestInfo, page: Page, slug: string) {
  const email = testEmail(slug, testInfo.project.name);
  await createTestUser(page.request, { email, password: PASSWORD, name: "Lia", twoFactor: true });
  const { householdId, personal } = await createHouseholdDirect({
    name: "Lar do resumo",
    people: [{ email, role: "OWNER" }],
  });
  created.push(householdId);
  const walletId = personal[email]!;
  const finance = await createFinanceDirect({
    householdId,
    accounts: [{ walletId, name: "Conta Aurora", kind: "CHECKING" }],
    categories: [
      { name: "Alimentação", kind: "EXPENSE" },
      { name: "Mercado", kind: "EXPENSE" },
      { name: "Restaurantes", kind: "EXPENSE" },
      { name: "Lazer", kind: "EXPENSE" },
    ],
  });
  await sql(`UPDATE category SET "parentId" = $1 WHERE id = $2`, [
    finance.categories["Alimentação"],
    finance.categories["Mercado"],
  ]);
  const accountId = finance.accounts["Conta Aurora"]!.id;
  const tx = (category: string, amount: string, occurredOn: string, description: string) =>
    sql(
      `INSERT INTO "transaction" (id, "householdId", "walletId", "accountId", method, "categoryId",
         amount, "occurredOn", description, "updatedAt")
       VALUES (gen_random_uuid(), $1, $2, $3, 'PIX', $4, $5, $6, $7, now())`,
      [
        householdId,
        walletId,
        accountId,
        finance.categories[category],
        amount,
        occurredOn,
        description,
      ],
    );
  return { householdId, walletId, accountId, categories: finance.categories, tx };
}

type Home = Awaited<ReturnType<typeof household>>;

/** Restaurantes: R$ 300,00 em cada um dos 6 meses antes do resumo, e R$ 600,00 no mês dele. */
async function restaurantsAboveUsual(h: Home) {
  for (let i = 1; i <= 6; i++) {
    await h.tx(
      "Restaurantes",
      "-300.00",
      `${addMonthsToKey(period.month, -i)}-10`,
      `RESTAURANTE ${i}`,
    );
  }
  await h.tx("Restaurantes", "-600.00", day0, "RESTAURANTE DO MES");
}

const section = (page: Page) => page.getByTestId("resumo-do-mes");

async function expectHeader(page: Page) {
  await expect(section(page).getByRole("heading", { level: 2 })).toHaveText(
    `Resumo de ${monthName(period.month)}`,
  );
  if (closed) await expect(section(page).getByText("Mês fechado")).toBeVisible();
}

/** O número leva à lista, e a lista soma o mesmo valor. */
async function expectListMatches(page: Page, link: ReturnType<Page["locator"]>) {
  const cents = BigInt((await link.getAttribute("data-cents")) ?? "x");
  const href = await link.getAttribute("href");
  expect(href).toMatch(/^\/lancamentos\?/);
  await openPage(page, href!);
  expect(centsOf(await page.getByTestId("total-saidas").innerText()), href!).toBe(cents);
}

test("o resumo do mês: as três observações, os números e as listas", async ({ page }, testInfo) => {
  test.slow(); // três listas abertas a partir do resumo
  const h = await household(testInfo, page, "resumo-tres");
  // Mercado: R$ 1.500,00 contra R$ 1.000,00 orçados (passa pelo menos R$ 500,00)
  await h.tx("Mercado", "-1500.00", day0, "SUPERMERC BOM PRECO");
  await sql(
    `INSERT INTO budget (id, "householdId", "walletId", "categoryId", month, amount, "updatedAt")
     VALUES (gen_random_uuid(), $1, $2, $3, $4, 1000, now())`,
    [h.householdId, h.walletId, h.categories["Mercado"], `${period.month}-01`],
  );
  // Uma assinatura nova no mês, com o lançamento dela (R$ 478,80 em 12 meses)
  const [rec] = await sql<{ id: string }>(
    `INSERT INTO recurrence (id, "householdId", "walletId", "accountId", "categoryId", kind, method,
       description, amount, "dayOfMonth", "startsOn", "updatedAt")
     VALUES (gen_random_uuid(), $1, $2, $3, $4, 'SUBSCRIPTION', 'PIX', 'STREAMFLIX', -39.90, $5, $6, now())
     RETURNING id`,
    [h.householdId, h.walletId, h.accountId, h.categories["Lazer"], Number(day0.slice(8)), day0],
  );
  await sql(
    `INSERT INTO "transaction" (id, "householdId", "walletId", "accountId", method, "categoryId",
       amount, "occurredOn", description, "recurrenceId", "externalId", source, "updatedAt")
     VALUES (gen_random_uuid(), $1, $2, $3, 'PIX', $4, -39.90, $5, 'STREAMFLIX', $6, $7, 'RECURRENCE', now())`,
    [
      h.householdId,
      h.walletId,
      h.accountId,
      h.categories["Lazer"],
      day0,
      rec!.id,
      `${rec!.id}:${period.month}`,
    ],
  );
  await restaurantsAboveUsual(h);

  await openPage(page, "/");
  await expectHeader(page);
  const items = section(page).getByRole("listitem");
  await expect(items).toHaveCount(3);
  expect(await items.evaluateAll((li) => li.map((e) => e.getAttribute("data-kind")))).toEqual([
    "OVER_BUDGET",
    "NEW_RECURRING",
    "ABOVE_USUAL",
  ]);
  await expect(items.nth(0)).toContainText(
    new RegExp(
      `^Mercado, no ambiente .+, ${closed ? "passou do orçado" : "deve passar do orçado"}`,
    ),
  );
  await expect(items.nth(1)).toContainText("Uma assinatura nova");
  await expect(items.nth(1)).toContainText("Em 12 meses: R$ 478,80");
  await expect(items.nth(2)).toContainText("Restaurantes acima do costume");
  await expect(items.nth(2)).toContainText("100 % acima da média de 6 meses");
  await expectNoA11yViolations(page);

  // Na tela mais estreita que a WCAG pede, nada passa da largura
  const size = page.viewportSize()!;
  await page.setViewportSize({ width: 320, height: size.height });
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
  await page.setViewportSize(size);

  // O orçado leva ao orçamento do mês; o gasto do "acima do costume" e o mensal da assinatura,
  // às listas que somam exatamente aquilo
  await expect(items.nth(0).getByRole("link").nth(1)).toHaveAttribute("href", /^\/orcamento\?/);
  const above = items.nth(2).getByRole("link").first();
  const monthly = items.nth(1).getByRole("link").first();
  const monthlyHref = await monthly.getAttribute("href");
  await expectListMatches(page, above);
  await openPage(page, monthlyHref!);
  expect(centsOf(await page.getByTestId("total-saidas").innerText())).toBe(3990n);
});

test("só uma observação: o resumo diz o que não apareceu", async ({ page }, testInfo) => {
  const h = await household(testInfo, page, "resumo-uma");
  await restaurantsAboveUsual(h);
  await openPage(page, "/");
  await expectHeader(page);
  await expect(section(page).getByRole("listitem")).toHaveCount(1);
  await expect(section(page)).toContainText(
    closed
      ? "Só aparece o que foge do costume: nenhum orçado estourou e nenhuma conta fixa nova no mês."
      : "Só aparece o que foge do costume: nenhum orçado deve estourar e nenhuma conta fixa nova este mês.",
  );
});

test("nada fora do costume", async ({ page }, testInfo) => {
  await household(testInfo, page, "resumo-nada");
  await openPage(page, "/");
  await expectHeader(page);
  await expect(section(page).getByRole("listitem")).toHaveCount(0);
  await expect(section(page)).toContainText(
    `Nada fora do costume em ${monthName(period.month)}${closed ? "" : " até agora"}.`,
  );
});
