import path from "node:path";
import { defineConfig } from "vitest/config";

// Testes de integração: falam com o PostgreSQL de verdade (o mesmo do pnpm dev).
// Em casa, a DATABASE_URL vem do .env da raiz; no CI, do workflow.
try {
  process.loadEnvFile(path.resolve(import.meta.dirname, "../../.env"));
} catch {
  // sem .env (CI): segue com as variáveis do ambiente
}

export default defineConfig({
  test: {
    include: ["src/**/*.integration.test.ts"],
    environment: "node",
    // Fuso de São Paulo de propósito: prova que as datas DATE não mudam de dia com o fuso
    env: { TZ: "America/Sao_Paulo" },
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
});
