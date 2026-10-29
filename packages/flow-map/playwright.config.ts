// O teste do site "FinTrack por dentro": o dist/site servido como o GitHub Pages serve (em
// /fintrack/), no Chromium, claro e escuro, computador e celular. Rode antes: pnpm site.
import { defineConfig, devices } from "@playwright/test";

const PORT = 4173;

export default defineConfig({
  testDir: "e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://127.0.0.1:${PORT}/fintrack/`,
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "computador",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
    },
    { name: "celular", use: { ...devices["Pixel 7"] } },
  ],
  webServer: {
    command: "pnpm site:serve",
    url: `http://127.0.0.1:${PORT}/fintrack/`,
    reuseExistingServer: !process.env.CI,
    env: { SITE_PORT: String(PORT) },
  },
});
