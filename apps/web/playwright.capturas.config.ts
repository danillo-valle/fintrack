// As capturas de tela do README (M12.2, ADR-021): o app com a casa fictícia do seed (24 meses de
// dados sintéticos), nos temas claro e escuro, no computador e no celular. Não faz parte da suíte:
//
//   pnpm capturas              (com o pnpm dev; ou PLAYWRIGHT_PRODUCTION=1 depois do build)
//
// Grava em docs/capturas/. ATENÇÃO: roda o seed de novo (apaga e refaz só a casa fictícia, nunca
// outra), com uma conta de teste própria (capturas@fintrack.test) como membro da Casa.
import { defineConfig, devices } from "@playwright/test";
import { CAPTURE_AUTH_FILE } from "./e2e/capturas/shared";
import base from "./playwright.config";

export default defineConfig({
  ...base,
  testDir: "./e2e/capturas",
  testIgnore: [],
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  projects: [
    { name: "preparar-capturas", testMatch: /preparar\.setup\.ts/ },
    {
      name: "computador",
      testMatch: /capturas\.spec\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1280, height: 800 },
        storageState: CAPTURE_AUTH_FILE,
      },
      dependencies: ["preparar-capturas"],
    },
    {
      name: "celular",
      testMatch: /capturas\.spec\.ts/,
      use: { ...devices["Pixel 7"], storageState: CAPTURE_AUTH_FILE },
      dependencies: ["preparar-capturas"],
    },
  ],
});
