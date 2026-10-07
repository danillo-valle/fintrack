// Prepara a conta que os testes usam já logada (Ana) e, desde o M06, o lar dela. Roda antes
// dos outros testes (projeto "preparar" no playwright.config.ts) e grava:
//   e2e/.auth/ana.json      os cookies da sessão (os outros testes começam já dentro do app)
//   e2e/.auth/ana-totp.txt  o segredo do app autenticador (para gerar códigos nos testes)
// A pasta .auth está no .gitignore: nada disso vai para o Git.
import { mkdirSync, writeFileSync } from "node:fs";
import { test as setup } from "@playwright/test";
import {
  ANA_HOUSEHOLD,
  AUTH_FILE,
  createHouseholdDirect,
  createTestUser,
  TEST_USER,
  TOTP_FILE,
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
  mkdirSync("e2e/.auth", { recursive: true });
  writeFileSync(TOTP_FILE, secret ?? "");
  await request.storageState({ path: AUTH_FILE });
});
