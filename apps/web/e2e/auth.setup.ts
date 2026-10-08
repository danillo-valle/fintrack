// Prepara a conta que os testes usam já logada (Ana) e, desde o M06, o lar dela. Roda antes
// dos outros testes (projeto "preparar" no playwright.config.ts) e grava:
//   e2e/.auth/ana.json      os cookies da sessão (os outros testes começam já dentro do app)
//   e2e/.auth/ana-totp.txt  o segredo do app autenticador (para gerar códigos nos testes)
// A pasta .auth está no .gitignore: nada disso vai para o Git.
import { mkdirSync, writeFileSync } from "node:fs";
import { test as setup } from "@playwright/test";
import {
  ANA_FINANCE,
  ANA_HOUSEHOLD,
  AUTH_FILE,
  createFinanceDirect,
  createHouseholdDirect,
  createTestUser,
  TEST_USER,
  TOTP_FILE,
  todaySaoPaulo,
} from "./helpers";

setup("cria a conta de teste com 2FA e guarda a sessão", async ({ request }) => {
  // A parceira primeiro e sem 2FA: createTestUser sem 2FA não faz login, então a sessão
  // guardada no fim continua sendo a da Ana
  await createTestUser(request, {
    ...ANA_HOUSEHOLD.partner,
    password: "frase da parceira de teste",
    twoFactor: false,
  });
  const { secret } = await createTestUser(request, { ...TEST_USER, twoFactor: true });

  // O lar da Ana (M06), com ids fixos (veja ANA_HOUSEHOLD em helpers.ts)
  await createHouseholdDirect({
    id: ANA_HOUSEHOLD.id,
    name: "Lar da Ana",
    people: [
      { email: TEST_USER.email, role: "OWNER", personalWalletId: ANA_HOUSEHOLD.personalWalletId },
      {
        email: ANA_HOUSEHOLD.partner.email,
        role: "MEMBER",
        personalWalletId: ANA_HOUSEHOLD.partnerWalletId,
      },
    ],
    shared: [
      {
        id: ANA_HOUSEHOLD.sharedWalletId,
        name: "Casa da Ana",
        members: [
          { email: TEST_USER.email, role: "OWNER" },
          { email: ANA_HOUSEHOLD.partner.email, role: "EDITOR" },
        ],
      },
      {
        name: "Viagem antiga",
        members: [{ email: TEST_USER.email, role: "OWNER" }],
        archived: true,
      },
    ],
  });
  // O dinheiro da Ana (M07): contas, cartão, categorias, uma regra e um lançamento de hoje
  await createFinanceDirect({
    householdId: ANA_HOUSEHOLD.id,
    accounts: [
      {
        id: ANA_FINANCE.checkingId,
        walletId: ANA_HOUSEHOLD.personalWalletId,
        name: "Conta da Ana",
        kind: "CHECKING",
        holderEmail: TEST_USER.email,
      },
      {
        id: ANA_FINANCE.cardAccountId,
        walletId: ANA_HOUSEHOLD.personalWalletId,
        name: "Cartão da Ana",
        kind: "CREDIT_CARD",
        holderEmail: TEST_USER.email,
        closingDay: 3,
        dueDay: 10,
        cards: [
          {
            id: ANA_FINANCE.cardId,
            nickname: "Master",
            lastFour: "1001",
            holderEmail: TEST_USER.email,
          },
        ],
      },
      {
        id: ANA_FINANCE.homeAccountId,
        walletId: ANA_HOUSEHOLD.sharedWalletId,
        name: "Conta da Casa",
        kind: "CHECKING",
        holderEmail: TEST_USER.email,
      },
    ],
    categories: [
      { id: ANA_FINANCE.mercadoId, name: "Mercado", kind: "EXPENSE" },
      { id: ANA_FINANCE.restauranteId, name: "Restaurante", kind: "EXPENSE" },
      { id: ANA_FINANCE.moradiaId, name: "Moradia", kind: "EXPENSE" },
      { id: ANA_FINANCE.salarioId, name: "Salário", kind: "INCOME" },
    ],
    rules: [{ pattern: "supermercado", category: "Mercado" }],
    transactions: [
      {
        id: ANA_FINANCE.transactionId,
        walletId: ANA_HOUSEHOLD.sharedWalletId,
        account: "Conta da Casa",
        amount: "-12.50",
        occurredOn: todaySaoPaulo(),
        description: "Padaria do Bairro",
        category: "Mercado",
      },
    ],
  });
  mkdirSync("e2e/.auth", { recursive: true });
  writeFileSync(TOTP_FILE, secret ?? "");
  await request.storageState({ path: AUTH_FILE });
});
