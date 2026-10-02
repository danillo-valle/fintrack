import { defineConfig, devices } from "@playwright/test";

const PORT = 3000;
const BASE_URL = `http://localhost:${PORT}`;
const CI = Boolean(process.env.CI);

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
  // Sobe o app antes dos testes. Se você já estiver com "pnpm dev" rodando, reaproveita.
  webServer: {
    command: "pnpm dev",
    url: `${BASE_URL}/api/health`,
    reuseExistingServer: !CI,
    timeout: 120_000,
  },
});
