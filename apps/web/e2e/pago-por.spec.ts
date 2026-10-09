// "Pago por", ambientes, parcelas e despesas fixas de ponta a ponta (M07.4, ADR-009), nos dois
// aparelhos (desktop e celular):
//
//   1. Lista: o quadrado da frente é quem pagou (iniciais), o filtro "Pago por" acha as compras
//      de cada um e o cartão de compras conjuntas aparece como Compartilhado.
//   2. Ambiente: "Tudo que vejo" junta o que a pessoa vê; o pessoal da outra pessoa nunca aparece.
//   3. Parcelada: uma compra vira N lançamentos, um por fatura; a lista do mês mostra a parcela 1.
//   4. Fixa: cria a recorrência e o lançamento do mês; "Lançar as deste mês" não duplica.
//   5. Ajustes > Contas: marcar um cartão como de compras conjuntas muda o "Pago por" na lista.
//
// Dados sintéticos: nomes inventados e finais de cartão 0001, 0002 e 0003.
import { expect, type Browser, type TestInfo } from "@playwright/test";
import {
  brl,
  createFinanceDirect,
  createHouseholdDirect,
  createTestUser,
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

function device(testInfo: TestInfo) {
  const mobile = testInfo.project.name === "celular";
  return mobile ? { viewport: { width: 412, height: 915 }, isMobile: true } : {};
}

/**
 * Um casal num lar: Bruna (a pessoa do teste, logada) e Caio. Ambiente "Casa" dos dois e um
 * pessoal de cada. Contas:
 *   - Conta da Bruna (corrente, titular Bruna, ambiente pessoal dela)
 *   - Cartão da casa (crédito, titular Caio, fecha dia 3, vence dia 10, ambiente Casa) com dois
 *     cartões: "Visa do Caio" (final 0002) e "Master conjunto" (final 0003, compras conjuntas)
 *   - Conta do Caio (corrente, titular Caio, ambiente pessoal dele)
 */
async function couple(browser: Browser, testInfo: TestInfo, slug: string) {
  const bruna = testEmail(`${slug}-bruna`, testInfo.project.name);
  const caio = testEmail(`${slug}-caio`, testInfo.project.name);
  const person = await personInNewTab(browser, bruna, "Bruna Prado", device(testInfo));
  await createTestUser(person.page.request, {
    email: caio,
    password: "frase longa para o caio do teste",
    name: "Caio Lima",
    twoFactor: false,
  });
  const household = await createHouseholdDirect({
    name: `Lar ${slug}`,
    people: [
      { email: bruna, role: "OWNER" },
      { email: caio, role: "MEMBER" },
    ],
    shared: [
      {
        name: "Casa",
        members: [
          { email: bruna, role: "OWNER" },
          { email: caio, role: "EDITOR" },
        ],
      },
    ],
  });
  created.push(household.householdId);
  const casa = household.shared["Casa"]!;
  const today = todaySaoPaulo();
  const finance = await createFinanceDirect({
    householdId: household.householdId,
    accounts: [
      {
        walletId: household.personal[bruna]!,
        name: "Conta da Bruna",
        kind: "CHECKING",
        holderEmail: bruna,
        cards: [{ nickname: "Débito da Bruna", lastFour: "0001", holderEmail: bruna }],
      },
      {
        walletId: casa,
        name: "Cartão da casa",
        kind: "CREDIT_CARD",
        holderEmail: caio,
        closingDay: 3,
        dueDay: 10,
        cards: [
          { nickname: "Visa do Caio", lastFour: "0002", holderEmail: caio },
          {
            nickname: "Master conjunto",
            lastFour: "0003",
            holderEmail: caio,
            sharedPurchases: true,
          },
        ],
      },
      {
        walletId: household.personal[caio]!,
        name: "Conta do Caio",
        kind: "CHECKING",
        holderEmail: caio,
      },
    ],
    categories: [{ name: "Mercado", kind: "EXPENSE" }],
    transactions: [
      // Na Casa: um Pix da Bruna, uma compra no cartão do Caio e uma no cartão conjunto
      {
        walletId: casa,
        account: "Conta da Bruna",
        amount: "-80.00",
        occurredOn: today,
        description: "Feira do sábado",
        category: "Mercado",
      },
      {
        walletId: casa,
        account: "Cartão da casa",
        card: "Visa do Caio",
        amount: "-45.50",
        occurredOn: today,
        description: "Farmácia da esquina",
      },
      {
        walletId: casa,
        account: "Cartão da casa",
        card: "Master conjunto",
        amount: "-212.30",
        occurredOn: today,
        description: "Supermercado do mês",
        category: "Mercado",
      },
      // No pessoal de cada um
      {
        walletId: household.personal[bruna]!,
        account: "Conta da Bruna",
        amount: "-39.90",
        occurredOn: today,
        description: "Livro da Bruna",
      },
      {
        walletId: household.personal[caio]!,
        account: "Conta do Caio",
        amount: "-150.00",
        occurredOn: today,
        description: "Presente secreto do Caio",
      },
    ],
  });
  return {
    ...person,
    bruna,
    caio,
    casa,
    householdId: household.householdId,
    brunaWallet: household.personal[bruna]!,
    ...finance,
  };
}

const rowOf = (page: import("@playwright/test").Page, description: string) =>
  page.getByRole("listitem").filter({ has: page.getByRole("link", { name: description }) });

test.describe("pago por e ambientes", () => {
  test("o quadrado é quem pagou; o filtro acha as compras de cada um", async ({
    browser,
  }, testInfo) => {
    test.slow();
    const p = await couple(browser, testInfo, "pagopor");
    const page = p.page;

    await openPage(page, "/lancamentos");
    // Quem pagou, pelas iniciais: Bruna (BP), Caio (CL) e o cartão conjunto (CP)
    await expect(
      rowOf(page, "Feira do sábado").getByRole("img", { name: "Pago por Bruna" }),
    ).toHaveText("BP");
    await expect(
      rowOf(page, "Farmácia da esquina").getByRole("img", { name: "Pago por Caio" }),
    ).toHaveText("CL");
    await expect(
      rowOf(page, "Supermercado do mês").getByRole("img", { name: "Pago por Compartilhado" }),
    ).toHaveText("CP");
    // O pessoal do Caio não existe para a Bruna (nem a linha, nem o total)
    await expect(page.getByText("Presente secreto do Caio")).toHaveCount(0);
    await expect(page.getByTestId("total-saidas")).toContainText(brl("R$ 377,70"));
    await expectNoA11yViolations(page);

    // Filtro "Pago por": Compartilhado
    const payerNav = page.getByRole("navigation", { name: "Pago por" });
    await payerNav.getByRole("link", { name: "Compartilhado" }).click();
    await expect(page).toHaveURL(/pago=compartilhado/);
    await expect(page.getByRole("link", { name: "Supermercado do mês" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Feira do sábado" })).toHaveCount(0);
    await expect(page.getByTestId("total-saidas")).toContainText(brl("R$ 212,30"));
    await expect(payerNav.getByRole("link", { name: "Compartilhado" })).toHaveAttribute(
      "aria-current",
      "true",
    );

    // Filtro "Pago por": Caio
    await payerNav.getByRole("link", { name: "Caio" }).click();
    await expect(page.getByRole("link", { name: "Farmácia da esquina" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Supermercado do mês" })).toHaveCount(0);

    // Todos de novo
    await payerNav.getByRole("link", { name: "Todos" }).click();
    await expect(page).not.toHaveURL(/pago=/);
    await expect(page.getByRole("link", { name: "Livro da Bruna" })).toBeVisible();
    await p.close();
  });

  test("o seletor de ambiente: Tudo que vejo, Casa e o pessoal", async ({ browser }, testInfo) => {
    const p = await couple(browser, testInfo, "ambiente");
    const page = p.page;

    await openPage(page, "/lancamentos");
    const switcher = page.getByRole("navigation", { name: "Ambiente" });
    // Tudo que vejo, Casa e o pessoal da Bruna; o do Caio, nunca
    await expect(switcher.getByRole("link")).toHaveCount(3);
    await expect(switcher.getByRole("link", { name: "Tudo que vejo" })).toHaveAttribute(
      "aria-current",
      "true",
    );
    await expect(page.getByText(/Somando os ambientes/)).toBeVisible();

    await switcher.getByRole("link", { name: "Casa" }).click();
    await expect(page).toHaveURL(new RegExp(`carteira=${p.casa}`));
    await expect(page.getByRole("link", { name: "Supermercado do mês" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Livro da Bruna" })).toHaveCount(0);
    await expect(page.getByTestId("total-saidas")).toContainText(brl("R$ 337,80"));

    // O Início usa o mesmo seletor
    await openPage(page, "/");
    await expect(page.getByRole("navigation", { name: "Ambiente" })).toBeVisible();
    await expectNoA11yViolations(page);
    await p.close();
  });
});

test.describe("tipo da despesa", () => {
  test("parcelada: 3 lançamentos, um por fatura; a lista do mês mostra a parcela 1", async ({
    browser,
  }, testInfo) => {
    test.slow();
    const p = await couple(browser, testInfo, "parcelada");
    const page = p.page;

    await openPage(page, "/lancamentos/novo");
    await page.getByLabel("Valor").pressSequentially("30000");
    await page.getByLabel("Descrição").fill("Cadeira de escritório");
    await page.getByText("Parcelada", { exact: true }).click();
    await page.getByLabel("Ambiente").selectOption({ label: "Casa" });
    await page
      .getByLabel("Pago com")
      .selectOption({ label: "Master conjunto final 0003 · compras conjuntas" });
    // Quem pagou vem do cartão (não se escolhe)
    await expect(
      page.getByRole("group", { name: "Pago por" }).getByText("Compartilhado"),
    ).toBeVisible();
    await page.getByLabel("Parcelas").selectOption("3");
    await expect(page.getByText(brl("R$ 100,00 × 3"))).toBeVisible();
    await expectNoA11yViolations(page);
    await page.getByRole("button", { name: "Salvar despesa" }).click();
    await expect(
      page.getByText(brl("Despesa de R$ 300,00 registrada em 3 parcelas")),
    ).toBeVisible();

    const rows = await sql<{ amount: string; status: string; n: number }>(
      `SELECT amount::text, status::text, "installmentNumber" AS n FROM "transaction"
       WHERE "householdId" = $1 AND description = 'Cadeira de escritório' ORDER BY "installmentNumber"`,
      [p.householdId],
    );
    expect(rows).toEqual([
      { amount: "-100.00", status: "CONFIRMED", n: 1 },
      { amount: "-100.00", status: "SCHEDULED", n: 2 },
      { amount: "-100.00", status: "SCHEDULED", n: 3 },
    ]);

    await openPage(page, "/lancamentos");
    const row = rowOf(page, "Cadeira de escritório");
    await expect(row).toHaveCount(1);
    await expect(row.getByTitle("Parcela 1 de 3")).toBeVisible();
    await expect(row.getByRole("img", { name: "Pago por Compartilhado" })).toBeVisible();
    await p.close();
  });

  test("fixa: cria a recorrência e o lançamento do mês, sem duplicar", async ({
    browser,
  }, testInfo) => {
    const p = await couple(browser, testInfo, "fixa");
    const page = p.page;
    const day = Number(todaySaoPaulo().slice(8, 10));

    await openPage(page, "/lancamentos/novo");
    await page.getByLabel("Valor").pressSequentially("6990");
    await page.getByLabel("Descrição").fill("Streaming de filmes");
    await page.getByText("Fixa", { exact: true }).click();
    await page.getByLabel("É uma").selectOption("SUBSCRIPTION");
    await expect(page.getByLabel("Vence dia")).toHaveValue(String(day));
    await expectNoA11yViolations(page);
    await page.getByRole("button", { name: "Salvar despesa" }).click();
    await expect(page.getByText(brl("Despesa de R$ 69,90 registrada todo mês"))).toBeVisible();

    const [recurrence] = await sql<{ id: string; kind: string; day: number }>(
      `SELECT id, kind::text, "dayOfMonth" AS day FROM recurrence WHERE "householdId" = $1`,
      [p.householdId],
    );
    expect(recurrence).toMatchObject({ kind: "SUBSCRIPTION", day });
    const count = async () =>
      (
        await sql<{ n: string }>(
          `SELECT count(*)::text AS n FROM "transaction" WHERE "recurrenceId" = $1`,
          [recurrence!.id],
        )
      )[0]!.n;
    expect(await count()).toBe("1");

    // "Lançar as deste mês" não cria outra
    await openPage(page, "/lancamentos/recorrencias");
    await expect(page.getByText("Streaming de filmes")).toBeVisible();
    await page.getByRole("button", { name: "Lançar as deste mês" }).click();
    await expect(
      page.getByText("Nada novo: as recorrências deste mês já estavam lançadas."),
    ).toBeVisible();
    expect(await count()).toBe("1");
    await p.close();
  });
});

test.describe("compras conjuntas em Ajustes > Contas", () => {
  test("marcar o cartão muda o Pago por de todas as compras dele", async ({
    browser,
  }, testInfo) => {
    const p = await couple(browser, testInfo, "conjunto");
    const page = p.page;

    await openPage(page, "/ajustes/contas");
    await page
      .getByRole("button", { name: "Marcar o cartão Visa do Caio como de compras conjuntas" })
      .click();
    await expect(page.getByText(/Cartão marcado como de compras conjuntas/)).toBeVisible();

    await openPage(page, "/lancamentos");
    await expect(
      rowOf(page, "Farmácia da esquina").getByRole("img", { name: "Pago por Compartilhado" }),
    ).toBeVisible();
    const [audit] = await sql<{ n: string }>(
      `SELECT count(*)::text AS n FROM audit_log WHERE "householdId" = $1 AND action = 'card.shared_purchases_changed'`,
      [p.householdId],
    );
    expect(audit!.n).toBe("1");
    await p.close();
  });
});
