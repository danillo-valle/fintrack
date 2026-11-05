// M13.3a de ponta a ponta (ADR-025, canvas linha N): contas e cartões separados. Cada aparelho usa
// uma pessoa e um lar próprios, com lançamentos sintéticos já conferidos.
//
//   1. Lançamentos: uma conta por vez, sem compra no cartão, com o saldo e a transferência fora
//   2. Cartões: a fatura com a compra e o estorno (que abate), sem débito misturado
//   3. Início: o resultado do mês e o número das saídas em duas partes, que somam o mesmo
//   4. O combo do Período com dois meses e o Novo lançamento com as abas
//   5. Fixas e parcelas, no menu
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

const PASSWORD = "frase longa da pessoa das contas separadas";

function daysAgo(days: number) {
  const [y, m, d] = todaySaoPaulo()
    .split("-")
    .map((n) => Number.parseInt(n, 10)) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d - days)).toISOString().slice(0, 10);
}

/** O dia do mês daqui a `days` dias, entre 1 e 28 (o fechamento e o vencimento aceitam até 28). */
function dayOfMonthAhead(days: number) {
  const today = Number.parseInt(todaySaoPaulo().slice(8), 10);
  return ((today + days - 1) % 28) + 1;
}

/** "R$ 150,00" sem o espaço especial do Intl, para comparar com o texto da tela. */
const brl = (text: string | null) => (text ?? "").replace(/\s/g, " ").trim();

const created: string[] = [];
test.afterEach(async () => {
  await deleteHouseholds(created.splice(0));
});

async function setup(page: Page, project: string) {
  const email = testEmail("contas-cartoes", project);
  await createTestUser(page.request, {
    email,
    password: PASSWORD,
    name: "Lia Separada",
    twoFactor: true,
  });
  const { householdId, personal } = await createHouseholdDirect({
    name: "Lar das contas separadas",
    people: [{ email, role: "OWNER" }],
  });
  created.push(householdId);
  const walletId = personal[email]!;
  const transfer = randomUUID();
  const { accounts } = await createFinanceDirect({
    householdId,
    accounts: [
      { walletId, name: "Aurora · Conta corrente", kind: "CHECKING", holderEmail: email },
      { walletId, name: "Aurora · Poupança", kind: "SAVINGS", holderEmail: email },
      {
        walletId,
        name: "Aurora Master",
        kind: "CREDIT_CARD",
        holderEmail: email,
        // A fatura aberta contém as compras dos últimos dias em qualquer dia do mês
        closingDay: dayOfMonthAhead(7),
        dueDay: dayOfMonthAhead(14),
        cards: [{ nickname: "Master Lia", lastFour: "0001", holderEmail: email }],
      },
    ],
    categories: [
      { name: "Mercado", kind: "EXPENSE" },
      { name: "Salário", kind: "INCOME" },
    ],
    transactions: [
      {
        walletId,
        account: "Aurora · Conta corrente",
        amount: "9850.00",
        occurredOn: daysAgo(0),
        description: "SALARIO EMPRESA EXEMPLO",
        category: "Salário",
      },
      {
        walletId,
        account: "Aurora · Conta corrente",
        amount: "-38.40",
        occurredOn: daysAgo(0),
        description: "PADARIA DO BAIRRO",
        category: "Mercado",
      },
      {
        walletId,
        account: "Aurora · Conta corrente",
        amount: "-500.00",
        occurredOn: daysAgo(0),
        description: "APLICACAO POUPANCA",
        transferId: transfer,
      },
      {
        walletId,
        account: "Aurora · Poupança",
        amount: "500.00",
        occurredOn: daysAgo(0),
        description: "APLICACAO POUPANCA",
        transferId: transfer,
      },
      {
        walletId,
        account: "Aurora Master",
        amount: "-200.00",
        occurredOn: daysAgo(0),
        description: "SUPER BEAL -CT",
        category: "Mercado",
        card: "Master Lia",
      },
      {
        walletId,
        account: "Aurora Master",
        amount: "50.00",
        occurredOn: daysAgo(0),
        description: "ESTORNO SUPER BEAL",
        category: "Mercado",
        card: "Master Lia",
      },
    ],
  });
  // O vencimento da fatura das compras de hoje (o gatilho do banco escolheu a fatura)
  const [bill] = await sql<{ dueDate: string }>(
    `SELECT to_char(s."dueDate", 'YYYY-MM-DD') AS "dueDate" FROM "transaction" t
       JOIN card_statement s ON s.id = t."statementId"
      WHERE t."accountId" = $1 LIMIT 1`,
    [accounts["Aurora Master"]!.id],
  );
  return { accounts, dueDate: bill!.dueDate };
}

test("contas e cartões separados: Lançamentos, Cartões, o Início e o recorte do painel", async ({
  page,
}, testInfo) => {
  test.slow(); // várias telas
  const { accounts, dueDate } = await setup(page, testInfo.project.name);
  const dueDm = `${dueDate.slice(8, 10)}/${dueDate.slice(5, 7)}`;
  const dueThisMonth = dueDate.slice(0, 7) === todaySaoPaulo().slice(0, 7);

  // ── 1. Lançamentos: a conta corrente, sem a compra no cartão ──
  await openPage(page, "/lancamentos");
  const tabs = page.getByRole("navigation", { name: "Conta" });
  await expect(tabs.getByRole("link")).toHaveCount(2);
  await expect(tabs.locator("[aria-current=true]")).toContainText("Conta corrente");
  const main = page.getByRole("main");
  await expect(main).toContainText("PADARIA DO BAIRRO");
  await expect(main).toContainText("APLICACAO POUPANCA");
  await expect(main).not.toContainText("SUPER BEAL");
  // A transferência aparece, mas fica fora das saídas; o saldo é o inicial mais tudo até hoje
  expect(brl(await page.getByTestId("total-saidas").textContent())).toContain("38,40");
  expect(brl(await page.getByTestId("conta-saldo-hoje").textContent())).toContain("9.311,60");
  await expectNoA11yViolations(page);
  // A poupança pela aba: o saldo de R$ 500,00 que entrou
  await tabs.getByRole("link", { name: /Poupança/ }).click();
  await expect(page).toHaveURL(new RegExp(`conta=${accounts["Aurora · Poupança"]!.id}`));
  expect(brl(await page.getByTestId("conta-saldo-hoje").textContent())).toContain("500,00");

  // ── 2. Cartões: a compra e o estorno, que abate ──
  await openPage(page, "/cartoes");
  await expect(page.getByRole("heading", { name: `Fatura que vence em ${dueDm}` })).toBeVisible();
  expect(brl(await page.getByTestId("fatura-total").textContent())).toContain("150,00");
  const purchases = page.getByRole("list", { name: "Compras desta fatura" });
  await expect(purchases).toContainText("SUPER BEAL -CT");
  await expect(purchases).toContainText("ESTORNO SUPER BEAL");
  await expect(purchases).not.toContainText("PADARIA");
  await expectNoA11yViolations(page);
  // O endereço antigo da página do cartão leva para cá
  await openPage(page, `/carteiras/conta/${accounts["Aurora Master"]!.id}`);
  await expect(page).toHaveURL(/\/cartoes\?conta=/);

  // ── 3. Início: o resultado do mês; as saídas em duas partes que somam o mesmo ──
  await openPage(page, "/");
  const result = page.getByRole("region", { name: /Resultado de/ });
  await expect(result).toContainText("9.850,00");
  const exits = page.getByTestId("resultado-saidas").getByRole("link");
  const exitsCents = await exits.getAttribute("data-cents");
  expect(exitsCents).toBe(dueThisMonth ? "18840" : "3840");
  await expect(page.getByRole("region", { name: "Na conta hoje" })).toContainText("9.311,60");
  await expect(page.getByRole("region", { name: "Guardado" })).toContainText("500,00");
  await expect(page.getByRole("region", { name: "Faturas a pagar" })).toContainText("150,00");
  await expectNoA11yViolations(page);
  await exits.click();
  await expect(page.getByRole("heading", { name: "Nas contas" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Nos cartões" })).toBeVisible();
  expect(brl(await page.getByTestId("recorte-contas").textContent())).toContain("38,40");
  expect(brl(await page.getByTestId("recorte-cartoes").textContent())).toContain(
    dueThisMonth ? "150,00" : "0,00",
  );
  expect(brl(await page.getByTestId("recorte-total").textContent())).toContain(
    dueThisMonth ? "188,40" : "38,40",
  );
  await expectNoA11yViolations(page);
});

test("o Período com dois meses, o Novo lançamento com abas e Fixas e parcelas", async ({
  page,
}, testInfo) => {
  await setup(page, testInfo.project.name);
  const today = todaySaoPaulo();
  const [y, m] = today.split("-").map((n) => Number.parseInt(n, 10)) as [number, number];
  const last = new Date(Date.UTC(y, m - 2, 15)).toISOString().slice(0, 7);

  // ── O combo do Período: marcar o mês passado junto com este ──
  await openPage(page, "/lancamentos");
  await page.getByRole("button", { name: /Período/ }).click();
  const panel = page.getByRole("region", { name: "Período" });
  await expect(panel).toBeVisible();
  await expectNoA11yViolations(page);
  await panel.locator(`input[name="mes"][value="${last}"]`).check();
  await panel.getByRole("button", { name: "Aplicar" }).click();
  await expect(page).toHaveURL(new RegExp(`mes=${last}`));
  await expect(page).toHaveURL(new RegExp(`mes=${today.slice(0, 7)}`));
  await expect(page.getByRole("button", { name: /Período/ })).toContainText("2 meses");
  // Esc fecha o painel do Pago por e devolve o foco
  const payer = page.getByRole("button", { name: /Pago por/ });
  await payer.click();
  await page.keyboard.press("Escape");
  await expect(payer).toBeFocused();

  // ── O Novo lançamento com as abas ──
  await openPage(page, "/lancamentos/novo?aba=transferencia");
  const tabs = page.getByRole("navigation", { name: "O que registrar" });
  await expect(tabs.locator("[aria-current=true]")).toContainText("Transferência");
  await expect(page.getByLabel("De (sai daqui)")).toBeVisible();
  await expectNoA11yViolations(page);
  await tabs.getByRole("link", { name: "Recorrência" }).click();
  await expect(page).toHaveURL(/aba=recorrencia/);
  // A aba trocou de verdade (a navegação terminou): o formulário da recorrência, com o caminho para
  // Fixas e parcelas (o link do texto, não o do menu)
  await expect(tabs.locator("[aria-current=true]")).toContainText("Recorrência");
  await expect(page.getByRole("button", { name: "Criar recorrência" })).toBeVisible();
  await expect(
    page.getByRole("main").getByRole("link", { name: "Fixas e parcelas", exact: true }),
  ).toBeVisible();
  // O endereço antigo da transferência leva para a aba
  await openPage(page, "/lancamentos/transferencia");
  await expect(page).toHaveURL(/aba=transferencia/);

  // ── Fixas e parcelas: a tela do menu (no celular, pelo Início) ──
  await openPage(page, "/fixas");
  await expect(page.getByRole("heading", { level: 1, name: "Fixas e parcelas" })).toBeVisible();
  for (const name of ["Entradas fixas", "Saídas fixas", "Parceladas em andamento"]) {
    await expect(page.getByRole("heading", { name })).toBeVisible();
  }
  await expectNoA11yViolations(page);
  await openPage(page, "/lancamentos/recorrencias");
  await expect(page).toHaveURL(/\/fixas$/);
});
