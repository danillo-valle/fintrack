import { defineConfig, devices } from "@playwright/test";

const PORT = 3000;
const BASE_URL = `http://localhost:${PORT}`;
const CI = Boolean(process.env.CI);

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
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "celular", use: { ...devices["Pixel 7"] } },
  ],
  // Sobe o app antes dos testes. Se você já estiver com "pnpm dev" rodando, reaproveita.
  webServer: {
    command: "pnpm dev",
    url: `${BASE_URL}/api/health`,
    reuseExistingServer: !CI,
    timeout: 120_000,
  },
});
