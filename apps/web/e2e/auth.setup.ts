// Prepara a conta que os testes usam já logada (Ana). Roda antes dos outros testes
// (projeto "preparar" no playwright.config.ts) e grava:
//   e2e/.auth/ana.json      os cookies da sessão (os outros testes começam já dentro do app)
//   e2e/.auth/ana-totp.txt  o segredo do app autenticador (para gerar códigos nos testes)
// A pasta .auth está no .gitignore: nada disso vai para o Git.
import { mkdirSync, writeFileSync } from "node:fs";
import { test as setup } from "@playwright/test";
import { AUTH_FILE, createTestUser, TEST_USER, TOTP_FILE } from "./helpers";

setup("cria a conta de teste com 2FA e guarda a sessão", async ({ request }) => {
  const { secret } = await createTestUser(request, { ...TEST_USER, twoFactor: true });
  mkdirSync("e2e/.auth", { recursive: true });
  writeFileSync(TOTP_FILE, secret ?? "");
  await request.storageState({ path: AUTH_FILE });
});
