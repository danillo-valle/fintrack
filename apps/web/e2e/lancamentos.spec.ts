// Lançamentos de ponta a ponta (M07), nos dois aparelhos (desktop e celular):
//
//   1. O uso diário: lançar em menos de 10 s com a categoria sugerida, achar na lista, corrigir
//      a categoria (vira exemplo de treino e regra) e excluir com "Desfazer".
//   2. A soma da lista bate com o banco ao centavo; transferência não entra no gasto.
//   3. IDOR: lançamento de outra pessoa responde a página 404, sem dado nenhum no HTML.
//   4. Recorrência: lançar o mês duas vezes não duplica.
//   5. Exportar CSV: pede reautenticação, baixa o arquivo e registra na auditoria.
//
// Os testes que conferem números criam um lar próprio (a Ana é usada por testes simultâneos).
import { readFile } from "node:fs/promises";
import { expect, type TestInfo } from "@playwright/test";
import {
  ageSessions,
  ANA_FINANCE,
  ANA_HOUSEHOLD,
  brl,
  createFinanceDirect,
  createHouseholdDirect,
  deleteHouseholds,
  expectNoA11yViolations,
  openPage,
  personInNewTab,
  sql,
  test,
  testEmail,
  todaySaoPaulo,
} from "./helpers";

const created: string[] = [];
test.afterEach(async () => {
  await deleteHouseholds(created.splice(0));
});

/** O aparelho do projeto atual, para a pessoa nova abrir no mesmo tipo de tela. */
function device(testInfo: TestInfo) {
  const mobile = testInfo.project.name === "celular";
  return mobile ? { viewport: { width: 412, height: 915 }, isMobile: true } : {};
}

/**
 * Uma pessoa com lar próprio: carteira pessoal, conta corrente, cartão, poupança e categorias
 * (Mercado e Restaurante, com a regra "supermercado" → Mercado).
 */
async function personWithMoney(
  browser: import("@playwright/test").Browser,
  testInfo: TestInfo,
  slug: string,
) {
  const email = testEmail(slug, testInfo.project.name);
  const person = await personInNewTab(browser, email, `Pessoa ${slug}`, device(testInfo));
  const household = await createHouseholdDirect({
    name: `Lar ${slug}`,
    people: [{ email, role: "OWNER" }],
  });
  created.push(household.householdId);
  const walletId = household.personal[email]!;
  const finance = await createFinanceDirect({
    householdId: household.householdId,
    accounts: [
      { walletId, name: "Conta corrente", kind: "CHECKING", holderEmail: email },
      { walletId, name: "Poupança", kind: "SAVINGS", holderEmail: email },
      {
        walletId,
        name: "Cartão",
        kind: "CREDIT_CARD",
        holderEmail: email,
        closingDay: 3,
        dueDay: 10,
      },
    ],
    categories: [
      { name: "Mercado", kind: "EXPENSE" },
      { name: "Restaurante", kind: "EXPENSE" },
    ],
    rules: [{ pattern: "supermercado", category: "Mercado" }],
  });
  return { ...person, email, walletId, householdId: household.householdId, ...finance };
}

test.describe("o uso diário", () => {
  test("lançar em menos de 10 s com a categoria sugerida, corrigir e excluir com desfazer", async ({
    browser,
  }, testInfo) => {
    test.slow();
    const p = await personWithMoney(browser, testInfo, "diario");
    const page = p.page;

    // 1. Lançar: valor, descrição, salvar (a categoria vem sozinha pela regra)
    // Uma visita antes do cronômetro: no servidor de desenvolvimento recém-ligado, a primeira visita
    // compila a página (no replay do M07.2, 10,6 s na primeira rodada e abaixo de 10 s nas seguintes).
    // Em produção não há compilação; o limite de 10 s continua o mesmo.
    await openPage(page, "/lancamentos/novo");
    const started = Date.now();
    await openPage(page, "/lancamentos/novo");
    await page.getByLabel("Valor").pressSequentially("4235");
    await page.getByLabel("Descrição").fill("Supermercado Bom Preço");
    await expect(page.getByText(/Sugerida: Mercado/)).toBeVisible();
    await expect(page.getByLabel("Categoria")).toHaveValue(p.categories["Mercado"]!);
    await page.getByRole("button", { name: "Salvar lançamento" }).click();
    await expect(page.getByText(brl("Despesa de R$ 42,35 registrada"))).toBeVisible();
    expect(Date.now() - started).toBeLessThan(10_000); // critério de pronto do roteiro
    await expect(page.getByLabel("Valor")).toHaveValue(brl("R$ 0,00"));

    const [row] = await sql<{ id: string; categorizedBy: string; amount: string }>(
      `SELECT id, "categorizedBy", amount::text FROM "transaction" WHERE "householdId" = $1`,
      [p.householdId],
    );
    expect(row).toMatchObject({ categorizedBy: "RULE", amount: "-42.35" });

    // 2. Achar na lista pelo texto (o filtro vai para a URL)
    await openPage(page, "/lancamentos?q=bom+pre");
    await expect(page.getByRole("link", { name: "Supermercado Bom Preço" })).toBeVisible();
    await expectNoA11yViolations(page);

    // 3. Corrigir a categoria e pedir "sempre categorizar assim"
    await page.getByRole("link", { name: "Supermercado Bom Preço" }).click();
    await expect(
      page.getByRole("heading", { level: 1, name: "Supermercado Bom Preço" }),
    ).toBeVisible();
    await expect(page.locator("html[data-hydrated]")).toBeAttached();
    await page.getByLabel("Categoria").selectOption({ label: "Restaurante" });
    await page.getByLabel("Sempre categorizar assim").check();
    await page.getByRole("button", { name: "Salvar alterações" }).click();
    await expect(page.getByText("Lançamento salvo.")).toBeVisible();

    const [example] = await sql<{ from: string; to: string }>(
      `SELECT "fromCategoryId" AS from, "toCategoryId" AS to FROM categorization_example WHERE "transactionId" = $1`,
      [row!.id],
    );
    expect(example).toEqual({ from: p.categories["Mercado"], to: p.categories["Restaurante"] });
    // A regra nova ("supermercado bom preco", mais específica) já vale para o próximo
    await openPage(page, "/lancamentos/novo");
    await page.getByLabel("Descrição").fill("SUPERMERCADO BOM PRECO 02/10");
    await expect(page.getByText(/Sugerida: Restaurante/)).toBeVisible();

    // 4. Excluir pela lista, com desfazer
    await openPage(page, "/lancamentos");
    await page.getByRole("button", { name: "Excluir Supermercado Bom Preço" }).click();
    await expect(page.getByRole("link", { name: "Supermercado Bom Preço" })).toHaveCount(0);
    await page.getByRole("button", { name: "Desfazer" }).click();
    await expect(page.getByText("Lançamento de volta")).toBeVisible();
    await openPage(page, "/lancamentos");
    await expect(page.getByRole("link", { name: "Supermercado Bom Preço" })).toBeVisible();
    await p.close();
  });
});

test.describe("números que batem", () => {
  test("a soma da lista bate com o banco ao centavo; transferência não é gasto", async ({
    browser,
  }, testInfo) => {
    const p = await personWithMoney(browser, testInfo, "soma");
    const today = todaySaoPaulo();
    // Valores escolhidos para pegar erro de arredondamento: 0,1 + 0,2 em number dá 0,30000000000000004
    for (const amount of ["-0.10", "-0.20", "-1234.56", "-0.01", "2500.00", "-999999.99"]) {
      await sql(
        `INSERT INTO "transaction" (id, "householdId", "walletId", "accountId", method, amount, "occurredOn", description, "updatedAt")
         VALUES (gen_random_uuid(), $1, $2, $3, 'PIX', $4, $5, 'Teste de soma', now())`,
        [p.householdId, p.walletId, p.accounts["Conta corrente"]!.id, amount, today],
      );
    }
    const page = p.page;

    // Transferência pela tela: guardar R$ 1.500,00 na poupança
    await openPage(page, "/lancamentos/transferencia");
    await page
      .getByLabel("De (sai daqui)")
      .selectOption({ label: "Conta corrente (Conta corrente)" });
    await page.getByLabel("Para (entra aqui)").selectOption({ label: "Poupança (Poupança)" });
    await page.getByLabel("Valor").pressSequentially("150000");
    await page.getByRole("button", { name: "Registrar transferência" }).click();
    await expect(page.getByText(/Transferência registrada/)).toBeVisible();

    await openPage(page, "/lancamentos");
    const [db] = await sql<{ entradas: string; saidas: string; linhas: string }>(
      `SELECT COALESCE(sum(amount) FILTER (WHERE amount > 0 AND "transferId" IS NULL), 0)::text AS entradas,
              COALESCE(sum(amount) FILTER (WHERE amount < 0 AND "transferId" IS NULL), 0)::text AS saidas,
              count(*)::text AS linhas
       FROM "transaction" WHERE "householdId" = $1 AND "deletedAt" IS NULL`,
      [p.householdId],
    );
    expect(db).toEqual({ entradas: "2500.00", saidas: "-1001234.86", linhas: "8" });
    // O valor e o sinal que o leitor de tela anuncia ("Despesa de"), não só a cor
    await expect(page.getByTestId("total-entradas")).toContainText(brl("R$ 2.500,00"));
    await expect(page.getByTestId("total-saidas")).toContainText(brl("R$ 1.001.234,86"));
    await expect(page.getByTestId("total-saidas")).toContainText("Despesa de");
    await expect(page.getByTestId("total-saldo")).toContainText(brl("R$ 998.734,86"));
    await expect(page.getByTestId("total-saldo")).toContainText("Despesa de");
    await expect(page.getByText("8 lançamentos no filtro.")).toBeVisible();
    await expect(page.getByText("Transferência", { exact: true }).first()).toBeVisible();
    await p.close();
  });
});

test.describe("IDOR: lançamento de outra pessoa", () => {
  test("a URL de um lançamento da Ana dá a página 404, sem dado nenhum", async ({
    browser,
  }, testInfo) => {
    const p = await personWithMoney(browser, testInfo, "idor-lanc");
    await openPage(p.page, `/lancamentos/${ANA_FINANCE.transactionId}`);
    await expect(p.page.getByText("Esta página não existe")).toBeVisible();
    const html = await p.page.content();
    expect(html).not.toContain("Padaria do Bairro");
    expect(html).not.toContain("Conta da Casa");
    // Filtrar pela carteira da Ana na URL não abre a porta: a lista vem vazia
    await openPage(p.page, `/lancamentos?carteira=${ANA_HOUSEHOLD.sharedWalletId}`);
    await expect(p.page.getByText("Nenhum lançamento neste filtro")).toBeVisible();
    expect(await p.page.content()).not.toContain("Padaria do Bairro");
    await p.close();
  });

  test("a Ana abre o próprio lançamento", async ({ page }) => {
    await openPage(page, `/lancamentos/${ANA_FINANCE.transactionId}`);
    await expect(page.getByRole("heading", { level: 1, name: "Padaria do Bairro" })).toBeVisible();
  });
});

test.describe("recorrências", () => {
  test("criar, lançar o mês duas vezes (sem duplicar) e confirmar", async ({
    browser,
  }, testInfo) => {
    const p = await personWithMoney(browser, testInfo, "recorrencia");
    const page = p.page;
    await openPage(page, "/lancamentos/recorrencias");
    await page.getByLabel("Descrição").fill("Aluguel");
    await page.getByLabel("Valor previsto").pressSequentially("250000");
    await page.getByLabel("Dia do mês").fill("1");
    await page.getByLabel("Começa em").fill(`${todaySaoPaulo().slice(0, 7)}-01`);
    await page.getByRole("button", { name: "Criar recorrência" }).click();
    await expect(page.getByText(/Recorrência criada/)).toBeVisible();

    await page.getByRole("button", { name: "Lançar as deste mês" }).click();
    await expect(page.getByText("1 lançamento agendado criado.")).toBeVisible();
    await page.getByRole("button", { name: "Lançar as deste mês" }).click();
    await expect(page.getByText(/Nada novo/)).toBeVisible();

    const [{ n }] = (await sql<{ n: string }>(
      `SELECT count(*)::text AS n FROM "transaction" WHERE "householdId" = $1 AND status = 'SCHEDULED'`,
      [p.householdId],
    )) as [{ n: string }];
    expect(n).toBe("1");

    await openPage(page, "/lancamentos");
    await expect(page.getByText("Agendado")).toBeVisible();
    await page.getByRole("link", { name: "Aluguel" }).click();
    await expect(page.locator("html[data-hydrated]")).toBeAttached();
    await page.getByRole("button", { name: "Confirmar: aconteceu" }).click();
    // A página se atualiza: a situação muda e o botão some
    await expect(page.getByRole("definition").filter({ hasText: /^Confirmado$/ })).toBeVisible();
    await expect(page.getByRole("button", { name: "Confirmar: aconteceu" })).toHaveCount(0);
    const [{ status }] = (await sql<{ status: string }>(
      `SELECT status FROM "transaction" WHERE "householdId" = $1`,
      [p.householdId],
    )) as [{ status: string }];
    expect(status).toBe("CONFIRMED");
    await p.close();
  });
});

test.describe("exportar CSV", () => {
  test("pede reautenticação, baixa o arquivo para o Excel e registra na auditoria", async ({
    browser,
  }, testInfo) => {
    const p = await personWithMoney(browser, testInfo, "exportar");
    await sql(
      `INSERT INTO "transaction" (id, "householdId", "walletId", "accountId", method, amount, "occurredOn", description, "updatedAt")
       VALUES (gen_random_uuid(), $1, $2, $3, 'PIX', -10.5, $4, '=HYPERLINK("http://x")', now())`,
      [p.householdId, p.walletId, p.accounts["Conta corrente"]!.id, todaySaoPaulo()],
    );
    await ageSessions(p.email, 60); // o login "aconteceu" há 1 hora
    const page = p.page;

    await openPage(page, "/lancamentos/exportar");
    await expect(page).toHaveURL(/\/reautenticar\?next=%2Flancamentos%2Fexportar/);
    await expect(page.locator("html[data-hydrated]")).toBeAttached();
    await page.getByLabel("Senha", { exact: true }).fill("frase longa para testar lancamentos");
    await page.getByRole("button", { name: "Confirmar", exact: true }).click();
    await expect(page).toHaveURL(/\/lancamentos\/exportar/);
    await expect(page.locator("html[data-hydrated]")).toBeAttached();
    await expectNoA11yViolations(page);

    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Baixar CSV" }).click();
    const file = await (await download).path();
    const csv = await readFile(file, "utf8");
    expect(csv.startsWith("﻿Data;Descrição;Valor;Tipo")).toBe(true);
    expect(csv).toContain(`"'=HYPERLINK(""http://x"")"`); // fórmula neutralizada
    expect(csv).toContain(";-10,50;Despesa;");
    await expect(page.getByText("Arquivo pronto: 1 lançamento.")).toBeVisible();

    const audit = await sql<{ action: string }>(
      `SELECT action FROM audit_log WHERE "householdId" = $1 AND action = 'transactions.exported'`,
      [p.householdId],
    );
    expect(audit).toHaveLength(1);
    await p.close();
  });
});
