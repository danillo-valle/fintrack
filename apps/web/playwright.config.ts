import { defineConfig, devices } from "@playwright/test";
import { WHATSAPP_FAKE } from "./e2e/whatsapp";

const PORT = 3000;
const BASE_URL = `http://localhost:${PORT}`;
const CI = Boolean(process.env.CI);
const PLUGGY_FAKE_URL = "http://127.0.0.1:8787";
// O serviço Python que lê a fatura em PDF (M09.4): o de verdade, com os PDFs sintéticos de
// samples/pdf. Ele confere o token do app em http://127.0.0.1:3000/api/auth/jwks
const ML_URL = "http://127.0.0.1:8001";
// A WhatsApp Cloud API de mentira (M11): o app manda as respostas para ela, e os testes fazem o
// papel da pessoa por ela (POST /__enviar). Os valores de mentira são os mesmos do .env.example
const WHATSAPP_ENV = {
  WHATSAPP_API_URL: `${WHATSAPP_FAKE.url}/v26.0`,
  WHATSAPP_APP_SECRET: WHATSAPP_FAKE.appSecret,
  WHATSAPP_ACCESS_TOKEN: WHATSAPP_FAKE.accessToken,
  WHATSAPP_VERIFY_TOKEN: WHATSAPP_FAKE.verifyToken,
  WHATSAPP_PHONE_NUMBER_ID: WHATSAPP_FAKE.phoneNumberId,
  WHATSAPP_DISPLAY_NUMBER: WHATSAPP_FAKE.displayNumber,
};

// Os testes acessam o banco e o Mailpit, então precisam das mesmas variáveis do app.
// Em casa, lê o .env da raiz; no CI, as variáveis vêm do workflow.
try {
  process.loadEnvFile("../../.env");
} catch {
  // sem .env (CI): segue com as variáveis do ambiente
}

// Arquivo com a sessão da conta de teste, criado pelo projeto "preparar"
const AUTH_FILE = "e2e/.auth/ana.json";

// Testes de ponta a ponta: abrem um navegador de verdade e usam o app como uma pessoa usaria.
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: CI, // no CI, um test.only esquecido reprova a execução
  retries: CI ? 2 : 0,
  // No terminal, uma linha por teste; sempre grava também o relatório HTML (playwright show-report)
  reporter: [[CI ? "github" : "list"], ["html", { open: "never" }]],
  use: {
    baseURL: BASE_URL,
    locale: "pt-BR",
    timezoneId: "America/Sao_Paulo",
    trace: "on-first-retry", // guarda um "filme" do teste quando ele falha e é repetido
  },
  projects: [
    // 1º: cria a conta de teste, liga o 2FA e guarda a sessão em AUTH_FILE
    { name: "preparar", testMatch: /auth\.setup\.ts/ },
    // Depois: todos os testes começam com essa sessão (quem precisa estar deslogado limpa)
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"], storageState: AUTH_FILE },
      dependencies: ["preparar"],
    },
    {
      name: "celular",
      use: { ...devices["Pixel 7"], storageState: AUTH_FILE },
      dependencies: ["preparar"],
    },
  ],
  // Sobe a Pluggy de mentira (M09.1), o serviço Python (M09.4), a Cloud API do WhatsApp de
  // mentira (M11) e o app antes dos testes. Se você já estiver com "pnpm pluggy:fake",
  // "pnpm ml:dev", "pnpm whatsapp:fake" e "pnpm dev" rodando, reaproveita (o .env aponta o app
  // para os três).
  webServer: [
    {
      command: "pnpm pluggy:fake",
      url: `${PLUGGY_FAKE_URL}/health`,
      reuseExistingServer: !CI,
      timeout: 30_000,
    },
    {
      command: "pnpm --filter @fintrack/ml dev",
      url: `${ML_URL}/health`,
      reuseExistingServer: !CI,
      timeout: 60_000,
    },
    {
      command: "pnpm whatsapp:fake",
      url: `${WHATSAPP_FAKE.url}/health`,
      reuseExistingServer: !CI,
      timeout: 30_000,
      env: WHATSAPP_ENV,
    },
    {
      command: "pnpm dev",
      url: `${BASE_URL}/api/health`,
      reuseExistingServer: !CI,
      timeout: 120_000,
      // Nenhum teste fala com a Pluggy de verdade
      env: { PLUGGY_API_URL: PLUGGY_FAKE_URL, ML_SERVICE_URL: ML_URL, ...WHATSAPP_ENV },
    },
  ],
});
