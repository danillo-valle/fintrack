// Coleta bancária (M09.1) de ponta a ponta, contra a Pluggy DE MENTIRA (e2e/pluggy-fake.ts, o
// banco sintético: Banco Aurora e Banco Exemplo, finais 0001 a 0003). Nenhum teste chama a Pluggy
// de verdade. Cada aparelho usa uma pessoa e um lar próprios (o lar da Ana não muda).
//
//   1. conectar: credenciais → ligar as contas (sugestão pelo final do cartão) → primeira busca
//   2. o Início mostra o saldo e a fatura aberta; os recebidos ficam fora das somas
//   3. a página do cartão: fatura aberta, fatura fechada conferida ao centavo, categoria em um
//      clique (inclusive criando uma categoria nova)
//   4. buscar de novo não cria lançamento nenhum
//   5. outra pessoa abre a página do cartão: 404 (a mesma resposta de "não existe")
import { expect, type Page } from "@playwright/test";
import { SYNTHETIC_CREDENTIALS, SYNTHETIC_IDS } from "@fintrack/importers/testing";
import {
  AUTH_FILE,
  brl,
  createFinanceDirect,
  createHouseholdDirect,
  createTestUser,
  expectNoA11yViolations,
  formAlert,
  openPage,
  sql,
  test,
  testEmail,
  todaySaoPaulo,
} from "./helpers";

const PASSWORD = "frase longa da pessoa da coleta bancaria";

/** Hoje menos N dias, no formato do <input type="date">. */
function daysAgo(days: number) {
  const [y, m, d] = todaySaoPaulo()
    .split("-")
    .map((n) => Number.parseInt(n, 10)) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d - days)).toISOString().slice(0, 10);
}

/** Recarrega a página até a última busca terminar (o worker roda em segundo plano). */
async function waitForSync(page: Page) {
  await expect
    .poll(
      async () => {
        await openPage(page, "/ajustes/conexoes/sincronizacoes");
        // Sem esperar: antes da primeira busca terminar, a tabela nem existe ("Nenhuma busca ainda")
        const done = page.getByRole("table").getByText(/Concluída|Falhou/);
        return (await done.count()) > 0 ? done.first().textContent() : null;
      },
      { timeout: 30_000, intervals: [500, 1000, 2000] },
    )
    .toBe("Concluída");
}

test("conectar o Meu Pluggy, ligar as contas e ver saldo, fatura e recebidos", async ({
  page,
  browser,
}, testInfo) => {
  test.slow(); // credenciais, ligação, duas buscas e várias páginas
  const email = testEmail("coleta", testInfo.project.name);
  await createTestUser(page.request, {
    email,
    password: PASSWORD,
    name: "Lia Coleta",
    twoFactor: true,
  });
  const { householdId, personal } = await createHouseholdDirect({
    name: "Lar da coleta",
    people: [{ email, role: "OWNER" }],
  });
  const walletId = personal[email]!;
  const { accounts } = await createFinanceDirect({
    householdId,
    accounts: [
      {
        walletId,
        name: "Mastercard",
        kind: "CREDIT_CARD",
        holderEmail: email,
        closingDay: 27,
        dueDay: 5,
        cards: [{ nickname: "Master 0001", lastFour: "0001", holderEmail: email }],
      },
    ],
  });
  const cardAccountId = accounts.Mastercard!.id;

  // ── 1. Credenciais (passo 1) ──
  await openPage(page, "/ajustes/conexoes");
  await expect(page.getByText("Não conectado")).toBeVisible();
  await page.getByRole("link", { name: "Conectar o Meu Pluggy" }).click();
  // A URL só muda quando a tela do modal chega do servidor (no pnpm dev recém-ligado, depois de
  // compilar a rota): esperar pela URL é esperar pelo estado, sem aumentar o tempo do expect
  await page.waitForURL("**/ajustes/conexoes/credenciais");
  const dialog = page.getByRole("dialog", { name: "Conectar o Meu Pluggy" });
  await expect(dialog).toBeVisible();
  // Sem nada: os avisos aparecem embaixo dos campos, e nada vai ao servidor
  await dialog.getByRole("button", { name: "Testar e continuar" }).click();
  await expect(dialog.getByText("Cole o Client ID do painel da Pluggy.")).toBeVisible();
  await expectNoA11yViolations(page); // o modal com os avisos embaixo dos campos
  await dialog.getByLabel("Client ID").fill(SYNTHETIC_CREDENTIALS.clientId);
  await dialog.getByRole("textbox", { name: "Client Secret" }).fill("segredo-errado-do-teste");
  await dialog
    .getByRole("textbox", { name: "Banco 1", exact: true })
    .fill(SYNTHETIC_IDS.itemAurora);
  await dialog.getByRole("button", { name: /Adicionar outro banco/ }).click();
  await dialog
    .getByRole("textbox", { name: "Banco 2", exact: true })
    .fill(SYNTHETIC_IDS.itemExemplo);
  await dialog.getByRole("button", { name: "Testar e continuar" }).click();
  // Credencial errada: a Pluggy recusa e NADA é gravado
  await expect(formAlert(page)).toContainText("A Pluggy recusou o Client ID e o Client Secret");
  expect(
    await sql(
      'SELECT 1 FROM provider_connection pc JOIN "user" u ON u.id = pc."userId" WHERE u.email = $1',
      [email],
    ),
  ).toHaveLength(0);
  // O Client ID e os bancos continuam preenchidos; o segredo volta em branco
  await expect(dialog.getByLabel("Client ID")).toHaveValue(SYNTHETIC_CREDENTIALS.clientId);
  await expect(dialog.getByRole("textbox", { name: "Client Secret" })).toHaveValue("");
  await dialog
    .getByRole("textbox", { name: "Client Secret" })
    .fill(SYNTHETIC_CREDENTIALS.clientSecret);
  await dialog.getByRole("button", { name: "Testar e continuar" }).click();

  // ── 2. Ligar as contas (passo 2) ──
  await page.waitForURL("**/ajustes/conexoes/ligar"); // o redirect da action (rota que compila)
  await expect(
    page.getByRole("heading", { name: "Ligar as contas" }).filter({ visible: true }),
  ).toBeVisible();
  const mastercard = page.getByLabel("Banco Aurora · Mastercard Gold").filter({ visible: true });
  // Sugerida pelo final do cartão (0001): a conta que já existia
  await expect(mastercard).toHaveValue(`existing:${cardAccountId}`);
  await expect(page.getByText("sugerido pelo final 0001").filter({ visible: true })).toBeVisible();
  await expect(
    page.getByLabel("Banco Aurora · Conta Corrente").filter({ visible: true }),
  ).toHaveValue("new");
  await expect(page.getByLabel("Banco Exemplo · Poupança").filter({ visible: true })).toHaveValue(
    "skip",
  );
  // A data de corte: 60 dias atrás, para a última fatura fechada inteira entrar
  await expectNoA11yViolations(page);
  await page.getByLabel("Importar a partir de").filter({ visible: true }).fill(daysAgo(60));
  await page
    .getByRole("button", { name: /Salvar e buscar/ })
    .filter({ visible: true })
    .click();

  // ── Primeira busca (o worker do pg-boss) ──
  await page.waitForURL("**/ajustes/conexoes/sincronizacoes");
  await waitForSync(page);
  await expectNoA11yViolations(page); // o histórico com uma busca concluída
  const created = await sql<{ n: string }>(
    `SELECT count(*)::text AS n FROM "transaction" WHERE "householdId" = $1 AND source = 'OPEN_FINANCE'`,
    [householdId],
  );
  expect(Number(created[0]!.n)).toBeGreaterThan(40);

  // ── 3. Início: contas e cartões, e o aviso dos recebidos ──
  await openPage(page, "/");
  const contas = page.getByRole("region", { name: "Contas e cartões" });
  await expect(contas.getByText("Mastercard final 0001", { exact: true })).toBeVisible();
  await expect(
    contas.getByRole("link", { name: /ver a fatura de Mastercard final 0001/ }),
  ).toContainText(brl("R$ 1.284,90"));
  await expect(contas.getByText(brl("R$ 4.218,36"))).toBeVisible();
  await expect(page.getByTestId("aviso-recebidos")).toContainText("lançamentos recebidos do banco");
  // Recebido fica FORA do painel: o gasto do mês continua zero
  await expect(page.getByTestId("inicio-gasto")).toContainText(brl("R$ 0,00"));

  // A lista padrão não mostra os recebidos; o link leva à fila deles
  await openPage(page, "/lancamentos");
  await expect(page.getByTestId("link-recebidos")).toBeVisible();
  await page.getByTestId("link-recebidos").click();
  await expect(page.getByRole("list", { name: "Recebidos do banco" })).toBeVisible();
  await expectNoA11yViolations(page);

  // ── 4. Página do cartão ──
  await contasCard(page, cardAccountId);
  await expect(page.getByTestId("fatura-aberta")).toContainText(brl("R$ 1.284,90"));
  await expect(page.getByTestId("fatura-total")).toContainText(brl("R$ 2.146,35"));
  await expect(page.getByTestId("fatura-confere")).toContainText("Confere ao centavo");
  await expectNoA11yViolations(page);
  // Categoria em um clique: sem categoria no lar ainda, cria "Restaurantes" pela busca
  const row = page
    .getByRole("list", { name: "Compras da fatura aberta" })
    .getByRole("listitem")
    .filter({ hasText: "RESTAURANTE SABOR" });
  await row.getByText("Escolher categoria").click();
  const picker = page.getByRole("dialog", { name: /Categoria.*RESTAURANTE SABOR/ });
  await expect(picker).toBeVisible();
  await expectNoA11yViolations(page); // a escolha de categoria aberta (balão ou painel)
  await picker.getByLabel("Buscar ou criar categoria").fill("Restaurantes");
  await picker.getByRole("button", { name: "Criar “Restaurantes”" }).click();
  await expect(row.getByText("Restaurantes")).toBeVisible();
  await expect(row.getByText("escolhida por você")).toBeVisible();
  // A escolha também vira o "Mais usadas" do próximo
  const mercado = page
    .getByRole("list", { name: "Compras da fatura aberta" })
    .getByRole("listitem")
    .filter({ hasText: "MERCADO BOM PRECO" });
  await mercado.getByText("Escolher categoria").click();
  const picker2 = page.getByRole("dialog", { name: /Categoria.*MERCADO BOM PRECO/ });
  await picker2.getByLabel("Buscar ou criar categoria").press("Escape");
  await expect(picker2).toBeHidden();

  // ── 5. Buscar de novo: zero lançamentos novos ──
  await openPage(page, "/ajustes/conexoes/sincronizacoes");
  await page
    .getByRole("button", { name: "Buscar agora" })
    .filter({ visible: true })
    .first()
    .click();
  await expect(formAlert(page).filter({ hasText: /Busca pedida|Já há uma busca/ })).toBeVisible();
  await expect
    .poll(
      async () => {
        const runs = await sql<{ n: string }>(
          `SELECT count(*)::text AS n FROM sync_run sr JOIN provider_connection pc ON pc.id = sr."connectionId"
       JOIN "user" u ON u.id = pc."userId" WHERE u.email = $1 AND sr.status = 'SUCCEEDED'`,
          [email],
        );
        return Number(runs[0]!.n);
      },
      { timeout: 30_000 },
    )
    .toBe(2);
  const after = await sql<{ n: string }>(
    `SELECT count(*)::text AS n FROM "transaction" WHERE "householdId" = $1 AND source = 'OPEN_FINANCE'`,
    [householdId],
  );
  expect(after[0]!.n).toBe(created[0]!.n);

  // ── 6. Outra pessoa (a Ana) abre a página do cartão: 404, sem nada do cartão no HTML ──
  const ana = await browser.newContext({ storageState: AUTH_FILE });
  const anaPage = await ana.newPage();
  await openPage(anaPage, `/carteiras/conta/${cardAccountId}`);
  await expect(anaPage.getByRole("heading", { name: "Esta página não existe" })).toBeVisible();
  expect(await anaPage.content()).not.toContain("1.284,90");
  await ana.close();
});

async function contasCard(page: Page, accountId: string) {
  await openPage(page, `/carteiras/conta/${accountId}`);
  await expect(
    page.getByRole("heading", { level: 1, name: "Mastercard final 0001" }),
  ).toBeVisible();
}
