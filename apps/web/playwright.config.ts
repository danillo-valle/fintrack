import { defineConfig, devices } from "@playwright/test";

// Testes de ponta a ponta: abrem o app num navegador de verdade e usam como uma pessoa usaria
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: "http://localhost:3000",
    locale: "pt-BR",
    timezoneId: "America/Sao_Paulo",
    trace: "on-first-retry",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] }, testIgnore: /\.celular\.spec\.ts$/ },
    // Largura de celular (abaixo de 768px): barra inferior e botão flutuante "+" na tela
    {
      name: "celular",
      use: { ...devices["Desktop Chrome"], viewport: { width: 390, height: 844 } },
      testMatch: /\.celular\.spec\.ts$/,
    },
  ],
  // Sobe o app sozinho; se ele já estiver rodando (pnpm dev), reaproveita
  webServer: {
    command: "pnpm dev",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
